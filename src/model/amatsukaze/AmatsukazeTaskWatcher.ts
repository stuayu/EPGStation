import { EventEmitter } from 'events';
import { isSameFilePath, toLocalPath } from './AmatsukazeConfigResolver';
import { AmatsukazePathMapping } from '../IConfigFile';
import {
    AmatsukazeConsoleText,
    AmatsukazeQueueItem,
    AmatsukazeServerState,
    AmatsukazeUIData,
    IAmatsukazeRpcClient,
} from './IAmatsukazeRpcClient';
import { AmatsukazeTaskProgress, AmatsukazeTaskResult, IAmatsukazeTaskWatcher } from './IAmatsukazeTaskWatcher';

/**
 * AmatsukazeServer のキューから特定のタスク (入力 TS パスで識別) を追跡し、
 * 進捗・処理状況・結果を通知する。
 *
 * AmatsukazeAddTask はタスク投入専用でリクエスト ID を外へ出さないため、
 * 入力ファイルのパスと投入時刻でキューの中から自分のタスクを特定する。
 */
export default class AmatsukazeTaskWatcher extends EventEmitter implements IAmatsukazeTaskWatcher {
    // 進捗が取れないときのフォールバック表示
    private static readonly UNKNOWN_PROGRESS_LOG = '状態を取得しています';
    // 状態が動かないことを確認する間隔 (ms)
    private static readonly TIMEOUT_CHECK_INTERVAL_MS = 30 * 1000;
    // コンソール出力の保持行数 (進捗表示にしか使わないので末尾だけ残す)
    private static readonly CONSOLE_KEEP_LINES = 20;
    // 画面へ出すログ 1 行の最大長
    private static readonly MAX_LOG_LENGTH = 200;

    private client: IAmatsukazeRpcClient;
    private srcPath: string;
    private pathMappings: AmatsukazePathMapping[];
    private taskTimeoutMs: number;

    // 監視対象として確定したキューアイテムの id (未確定のうちは null)
    private targetItemId: number | null = null;
    private targetItem: AmatsukazeQueueItem | null = null;
    // キュー全体 (待ち順の算出に使う)
    private queueItems: AmatsukazeQueueItem[] = [];
    private serverState: AmatsukazeServerState | null = null;
    // コンソール番号ごとの最新の進捗行
    private consoleTexts: Map<number, string[]> = new Map();
    private lastProgress: AmatsukazeTaskProgress | null = null;
    private lastChangedAt: number = Date.now();
    private timeoutTimer: NodeJS.Timeout | null = null;
    private isFinished: boolean = false;

    constructor(
        client: IAmatsukazeRpcClient,
        srcPath: string,
        pathMappings: AmatsukazePathMapping[],
        taskTimeoutMs: number,
    ) {
        super();
        this.client = client;
        this.srcPath = srcPath;
        this.pathMappings = pathMappings;
        this.taskTimeoutMs = taskTimeoutMs;
    }

    /**
     * 監視を開始する (RPC クライアントは接続済みであること)
     * @return Promise<void>
     */
    public async start(): Promise<void> {
        this.client.on('uiData', (data: AmatsukazeUIData) => {
            this.onUIData(data);
        });
        this.client.on('consoleUpdate', (data: AmatsukazeConsoleText) => {
            this.onConsoleUpdate(data);
        });
        this.client.on('error', (err: Error) => {
            this.emit('error', err);
        });

        await this.client.requestAll();

        if (this.taskTimeoutMs > 0) {
            this.timeoutTimer = setInterval(() => {
                if (Date.now() - this.lastChangedAt < this.taskTimeoutMs) {
                    return;
                }
                this.emit(
                    'error',
                    new Error(`Amatsukaze のタスクの状態が ${this.taskTimeoutMs} ms 変化しなかったため打ち切ります`),
                );
                this.stop();
            }, AmatsukazeTaskWatcher.TIMEOUT_CHECK_INTERVAL_MS);
            this.timeoutTimer.unref();
        }
    }

    /**
     * 監視を終了する (Amatsukaze 側のタスクには触らない)
     */
    public stop(): void {
        if (this.timeoutTimer !== null) {
            clearInterval(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    /**
     * 監視対象のタスクを Amatsukaze のキューからキャンセルする
     * @return Promise<void>
     */
    public async cancel(): Promise<void> {
        if (this.targetItemId === null) {
            return;
        }

        await this.client.changeItem(this.targetItemId, 'Cancel');
    }

    /**
     * UIData を受けて状態を更新する
     * @param data: AmatsukazeUIData
     */
    private onUIData(data: AmatsukazeUIData): void {
        if (typeof data.queueItems !== 'undefined') {
            this.queueItems = data.queueItems;
            const matched = this.findTargetFromQueue(data.queueItems);
            if (matched !== null) {
                this.setTarget(matched);
            }
        }

        if (typeof data.updatedItem !== 'undefined') {
            const item = data.updatedItem;
            this.mergeQueueItem(item, data.updateType);
            if (this.isTarget(item) === true) {
                if (data.updateType === 'Remove') {
                    // キューから消えた = 別経路で削除された
                    this.finish({
                        state: 'Canceled',
                        isSucceeded: false,
                        outputPath: null,
                        failReason: 'Amatsukaze のキューからタスクが削除されました',
                        encodeTimeMs: item.encodeTimeMs,
                    });

                    return;
                }
                this.setTarget(item);
            }
        }

        if (typeof data.state !== 'undefined') {
            this.serverState = data.state;
        }

        if (typeof data.console !== 'undefined') {
            this.consoleTexts.set(data.console.index, data.console.lines);
        }

        this.publishProgress();
    }

    /**
     * コンソール出力の差分を受けて保持する
     * @param data: AmatsukazeConsoleText
     */
    private onConsoleUpdate(data: AmatsukazeConsoleText): void {
        const current = this.consoleTexts.get(data.index) ?? [];
        const merged = current.concat(data.lines);
        // 進捗表示にしか使わないので末尾だけ残す
        this.consoleTexts.set(
            data.index,
            merged.slice(Math.max(0, merged.length - AmatsukazeTaskWatcher.CONSOLE_KEEP_LINES)),
        );

        this.publishProgress();
    }

    /**
     * キュー一覧から監視対象のタスクを探す。
     * 同じ入力ファイルの過去のタスクが残っていることがあるため、追加時刻が最も新しいものを採る
     * @param items: AmatsukazeQueueItem[]
     * @return AmatsukazeQueueItem | null
     */
    private findTargetFromQueue(items: AmatsukazeQueueItem[]): AmatsukazeQueueItem | null {
        let candidate: AmatsukazeQueueItem | null = null;

        for (const item of items) {
            if (this.isTarget(item) === false) {
                continue;
            }
            if (candidate === null) {
                candidate = item;
                continue;
            }
            // 追加時刻 → id の順で新しい方を採る
            const candidateTime = candidate.addTime ?? 0;
            const itemTime = item.addTime ?? 0;
            if (itemTime > candidateTime || (itemTime === candidateTime && item.id > candidate.id)) {
                candidate = item;
            }
        }

        return candidate;
    }

    /**
     * 監視対象のタスクかどうか
     * @param item: AmatsukazeQueueItem
     * @return boolean
     */
    private isTarget(item: AmatsukazeQueueItem): boolean {
        if (this.targetItemId !== null) {
            return item.id === this.targetItemId;
        }

        return isSameFilePath(item.srcPath, this.srcPath);
    }

    /**
     * 差分更新をキュー一覧へ反映する
     * @param item: AmatsukazeQueueItem
     * @param updateType: AmatsukazeUIData['updateType']
     */
    private mergeQueueItem(item: AmatsukazeQueueItem, updateType: AmatsukazeUIData['updateType']): void {
        const index = this.queueItems.findIndex(queueItem => queueItem.id === item.id);
        if (updateType === 'Remove') {
            if (index >= 0) {
                this.queueItems.splice(index, 1);
            }

            return;
        }

        if (index >= 0) {
            this.queueItems[index] = item;
        } else {
            this.queueItems.push(item);
        }
    }

    /**
     * 監視対象を確定・更新し、終了状態なら結果を通知する
     * @param item: AmatsukazeQueueItem
     */
    private setTarget(item: AmatsukazeQueueItem): void {
        if (this.targetItemId === null) {
            this.targetItemId = item.id;
        }
        if (this.targetItem === null || this.targetItem.state !== item.state) {
            this.lastChangedAt = Date.now();
        }
        this.targetItem = item;

        switch (item.state) {
            case 'Complete':
                this.finish({
                    state: item.state,
                    isSucceeded: true,
                    outputPath: item.actualDstPath === null ? null : toLocalPath(item.actualDstPath, this.pathMappings),
                    failReason: null,
                    encodeTimeMs: item.encodeTimeMs,
                });
                break;
            case 'Failed':
            case 'PreFailed':
                this.finish({
                    state: item.state,
                    isSucceeded: false,
                    outputPath: null,
                    failReason: item.failReason,
                    encodeTimeMs: item.encodeTimeMs,
                });
                break;
            case 'Canceled':
                this.finish({
                    state: item.state,
                    isSucceeded: false,
                    outputPath: null,
                    failReason: 'Amatsukaze 側でタスクがキャンセルされました',
                    encodeTimeMs: item.encodeTimeMs,
                });
                break;
            default:
                break;
        }
    }

    /**
     * 結果を 1 度だけ通知する
     * @param result: AmatsukazeTaskResult
     */
    private finish(result: AmatsukazeTaskResult): void {
        if (this.isFinished === true) {
            return;
        }
        this.isFinished = true;
        this.stop();
        this.emit('finish', result);
    }

    /**
     * 現在の進捗を組み立てて通知する (前回と同じ内容なら通知しない)
     */
    private publishProgress(): void {
        if (this.isFinished === true) {
            return;
        }

        const progress = this.createProgress();
        if (progress === null) {
            return;
        }

        if (
            this.lastProgress !== null &&
            this.lastProgress.percent === progress.percent &&
            this.lastProgress.log === progress.log
        ) {
            return;
        }

        this.lastProgress = progress;
        this.lastChangedAt = Date.now();
        this.emit('update', progress);
    }

    /**
     * 現在の進捗を組み立てる
     * @return AmatsukazeTaskProgress | null 監視対象がまだ見つかっていない場合は null
     */
    private createProgress(): AmatsukazeTaskProgress | null {
        const item = this.targetItem;
        if (item === null) {
            return null;
        }

        const suffix = item.profileName === null ? '' : ` profile:${item.profileName}`;

        switch (item.state) {
            case 'LogoPending':
                return { percent: 0, log: `ロゴ・プロファイル待ち${suffix}`, state: item.state };
            case 'Queue': {
                const position = this.getQueuePosition(item);
                const positionText = position === null ? '' : ` (${position} 番目)`;

                return { percent: 0, log: `Amatsukaze のキュー待ち${positionText}${suffix}`, state: item.state };
            }
            case 'Encoding': {
                const percent = this.getEncodingPercent(item);
                const consoleLine = this.getLatestConsoleLine(item.consoleId);
                const log =
                    consoleLine === null
                        ? `Amatsukaze でエンコード中${suffix}`
                        : `Amatsukaze でエンコード中: ${consoleLine}`;

                return { percent: percent, log: log, state: item.state };
            }
            default:
                return {
                    percent: 0,
                    log: `${AmatsukazeTaskWatcher.UNKNOWN_PROGRESS_LOG}${suffix}`,
                    state: item.state,
                };
        }
    }

    /**
     * キュー待ちの順番 (1 始まり) を返す
     * @param item: AmatsukazeQueueItem
     * @return number | null 算出できない場合は null
     */
    private getQueuePosition(item: AmatsukazeQueueItem): number | null {
        const waiting = this.queueItems.filter(
            queueItem => queueItem.state === 'Queue' || queueItem.state === 'LogoPending',
        );
        const index = waiting.findIndex(queueItem => queueItem.id === item.id);

        return index < 0 ? null : index + 1;
    }

    /**
     * エンコード中の進捗 (0〜1) を返す。
     * 自分のタスクを実行しているコンソールの出力から百分率を拾い、
     * 取れない場合はサーバ全体の進捗で代用する
     * @param item: AmatsukazeQueueItem
     * @return number
     */
    private getEncodingPercent(item: AmatsukazeQueueItem): number {
        const lines = this.consoleTexts.get(item.consoleId) ?? [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const matched = /(\d+(?:\.\d+)?)\s*%/.exec(lines[i]);
            if (matched !== null) {
                const percent = parseFloat(matched[1]) / 100;
                if (Number.isFinite(percent) === true) {
                    return Math.min(Math.max(percent, 0), 1);
                }
            }
        }

        if (this.serverState !== null && this.serverState.progress > 0) {
            return Math.min(Math.max(this.serverState.progress, 0), 1);
        }

        return 0;
    }

    /**
     * 表示に使う最新のコンソール行を返す
     * @param consoleId: number
     * @return string | null
     */
    private getLatestConsoleLine(consoleId: number): string | null {
        const lines = this.consoleTexts.get(consoleId) ?? [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.length > 0) {
                return line.slice(0, AmatsukazeTaskWatcher.MAX_LOG_LENGTH);
            }
        }

        return null;
    }
}
