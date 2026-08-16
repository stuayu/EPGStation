import { EventEmitter } from 'events';
import { isSameFilePath, toLocalPath } from './AmatsukazeConfigResolver';
import { AmatsukazePathMapping } from '../IConfigFile';
import {
    AmatsukazeConsoleText,
    AmatsukazeQueueItem,
    AmatsukazeUIData,
    IAmatsukazeRpcClient,
} from './IAmatsukazeRpcClient';
import { AmatsukazeTaskProgress, AmatsukazeTaskResult, IAmatsukazeTaskWatcher } from './IAmatsukazeTaskWatcher';

/**
 * AmatsukazeServer のキューから特定のタスク (入力 TS パスで識別) を追跡し、
 * 進捗・処理状況・結果を通知する。
 *
 * AmatsukazeAddTask はタスク投入専用でリクエスト ID を外へ出さないため、
 * 入力ファイルのパスでキューの中から自分のタスクを特定する。
 *
 * **タスクの探索は投入が済んだ (`markTaskAdded()`) 後にしか行わない**。
 * Amatsukaze のキューには同じ入力ファイルの過去のタスク (前回失敗した分など) が
 * 残っていることがあり、投入前のキューから探すとそれを自分のタスクと取り違えて
 * 「投入した瞬間に失敗・キャンセルされた」ことになってしまうため。
 * 投入前に見えていたアイテムの id は覚えておき、候補から外す。
 */
export default class AmatsukazeTaskWatcher extends EventEmitter implements IAmatsukazeTaskWatcher {
    // 進捗が取れないときのフォールバック表示
    private static readonly UNKNOWN_PROGRESS_LOG = '状態を取得しています';
    // 状態が動かないことを確認する間隔 (ms)
    private static readonly TIMEOUT_CHECK_INTERVAL_MS = 30 * 1000;
    // タスク投入後、自分のタスクがキューに現れるのを待つ時間 (ms)
    private static readonly TARGET_WAIT_TIMEOUT_MS = 60 * 1000;
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
    // 最後に拾えたエンコードの進捗 (百分率が出ない段階では直前の値を保つ)
    private lastEncodingPercent: number = 0;
    // コンソール番号ごとの最新の進捗行
    private consoleTexts: Map<number, string[]> = new Map();
    private lastProgress: AmatsukazeTaskProgress | null = null;
    private lastChangedAt: number = Date.now();
    private timeoutTimer: NodeJS.Timeout | null = null;
    private isFinished: boolean = false;
    // タスク投入が済んだか (済むまでは対象を探さない)
    private isTaskAdded: boolean = false;
    // 投入前からキューに居たアイテムの id (自分のタスクではないので候補から外す)
    private preExistingItemIds: Set<number> = new Set();
    // 投入前のキュー全体を受け取ったか (除外リストはこの 1 回で確定させる)
    private hasQueueSnapshot: boolean = false;
    // 投入したタスクがキューに現れるのを待つタイマー
    private targetWaitTimer: NodeJS.Timeout | null = null;
    private hasInitialQueueSnapshot: boolean = false;
    private initialQueueSnapshotWaiters: Array<() => void> = [];

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
     * 投入前のキュー一覧を受信するまで待つ。
     * requestAll() は RPC の送信完了しか待たないため、応答前にタスクを追加すると
     * 追加したタスクと同じ入力を持つ過去のタスクを誤って拾うことがある。
     * @return Promise<void>
     */
    public waitForInitialQueueSnapshot(): Promise<void> {
        if (this.hasInitialQueueSnapshot === true) {
            return Promise.resolve();
        }

        return new Promise<void>(resolve => {
            this.initialQueueSnapshotWaiters.push(resolve);
        });
    }

    /**
     * タスクの投入が済んだことを伝える。
     * これを呼ぶまで対象の探索は行わない (投入前からキューに居るアイテムを
     * 自分のタスクと取り違えないようにするため)
     */
    public markTaskAdded(): void {
        if (this.isTaskAdded === true) {
            return;
        }
        this.isTaskAdded = true;

        // 投入前に受け取っていたキューの中に、投入後のものが混ざっていることがあるので探し直す
        this.updateTargetFromQueue();
        this.publishProgress();

        if (this.targetItemId !== null) {
            return;
        }

        // 投入したはずのタスクがいつまでもキューに現れない場合に備える
        this.targetWaitTimer = setTimeout(() => {
            this.targetWaitTimer = null;
            if (this.targetItemId !== null || this.isFinished === true) {
                return;
            }
            this.emit(
                'error',
                new Error(
                    `投入したタスクが Amatsukaze のキューに現れませんでした (${AmatsukazeTaskWatcher.TARGET_WAIT_TIMEOUT_MS} ms 待機): ${this.srcPath}`,
                ),
            );
        }, AmatsukazeTaskWatcher.TARGET_WAIT_TIMEOUT_MS);
        this.targetWaitTimer.unref();
    }

    /**
     * 監視を終了する (Amatsukaze 側のタスクには触らない)
     */
    public stop(): void {
        if (this.timeoutTimer !== null) {
            clearInterval(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.targetWaitTimer !== null) {
            clearTimeout(this.targetWaitTimer);
            this.targetWaitTimer = null;
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
            if (this.hasInitialQueueSnapshot === false) {
                this.hasInitialQueueSnapshot = true;
                const waiters = this.initialQueueSnapshotWaiters.splice(0);
                for (const resolve of waiters) {
                    resolve();
                }
            }
            this.rememberPreExistingItems(data.queueItems);
            this.updateTargetFromQueue();
        }

        if (typeof data.updatedItem !== 'undefined') {
            const item = data.updatedItem;
            this.mergeQueueItem(item, data.updateType);
            if (this.isTaskAdded === true && this.isTarget(item) === true) {
                if (data.updateType === 'Remove') {
                    // キューから消えた = 別経路で削除された
                    this.finish({
                        state: 'Canceled',
                        isSucceeded: false,
                        sourcePath: this.srcPath,
                        outputPath: null,
                        outputPathBase: null,
                        failReason: 'Amatsukaze のキューからタスクが削除されました',
                        encodeTimeMs: item.encodeTimeMs,
                    });

                    return;
                }
                this.setTarget(item);
            }
        }

        // data.state (State.Progress) はキュー全体の進み具合なので、タスクの進捗には使わない

        if (typeof data.console !== 'undefined') {
            this.consoleTexts.set(data.console.index, AmatsukazeTaskWatcher.splitConsoleLines(data.console.lines));
        }

        this.publishProgress();
    }

    /**
     * コンソール出力の差分を受けて保持する
     * @param data: AmatsukazeConsoleText
     */
    private onConsoleUpdate(data: AmatsukazeConsoleText): void {
        const current = this.consoleTexts.get(data.index) ?? [];
        const merged = current.concat(AmatsukazeTaskWatcher.splitConsoleLines(data.lines));
        // 進捗表示にしか使わないので末尾だけ残す
        this.consoleTexts.set(
            data.index,
            merged.slice(Math.max(0, merged.length - AmatsukazeTaskWatcher.CONSOLE_KEEP_LINES)),
        );

        this.publishProgress();
    }

    /**
     * タスク投入前から居たアイテムとして id を控える。
     *
     * **控えるのは `start()` の `requestAll()` で返ってくるキュー全体の 1 回だけ**。
     * 差分更新 (QueueUpdate) まで控えると、`AmatsukazeAddTask` の実行中に届いた
     * 自分のタスクの Add 通知を「投入前から居たもの」として除外してしまい、
     * 投入したのに永久に見つからなくなる (投入完了を伝える `markTaskAdded()` は
     * AddTask プロセスの終了後にしか呼べないため、Add 通知の方が先に届く)
     * @param items: AmatsukazeQueueItem[]
     */
    private rememberPreExistingItems(items: AmatsukazeQueueItem[]): void {
        if (this.isTaskAdded === true || this.hasQueueSnapshot === true) {
            return;
        }
        this.hasQueueSnapshot = true;

        for (const item of items) {
            this.preExistingItemIds.add(item.id);
        }
    }

    /**
     * 現在のキューから監視対象を探し直す (投入が済むまでは何もしない)
     */
    private updateTargetFromQueue(): void {
        if (this.isTaskAdded === false) {
            return;
        }

        const matched = this.findTargetFromQueue(this.queueItems);
        if (matched !== null) {
            this.setTarget(matched);
        }
    }

    /**
     * キュー一覧から監視対象のタスクを探す。
     * 同じ入力ファイルの過去のタスクが残っていることがあるため、
     * 投入前から居たアイテムは除外した上で追加時刻が最も新しいものを採る
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

        // 投入前から居たアイテム (前回失敗したタスクなど) は自分のものではない
        if (this.preExistingItemIds.has(item.id) === true) {
            return false;
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
            if (this.targetWaitTimer !== null) {
                clearTimeout(this.targetWaitTimer);
                this.targetWaitTimer = null;
            }
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
                    sourcePath: this.srcPath,
                    outputPath: item.actualDstPath === null ? null : toLocalPath(item.actualDstPath, this.pathMappings),
                    outputPathBase: item.dstPath === null ? null : toLocalPath(item.dstPath, this.pathMappings),
                    failReason: null,
                    encodeTimeMs: item.encodeTimeMs,
                });
                break;
            case 'Failed':
            case 'PreFailed':
                this.finish({
                    state: item.state,
                    isSucceeded: false,
                    sourcePath: this.srcPath,
                    outputPath: null,
                    outputPathBase: null,
                    failReason: item.failReason,
                    encodeTimeMs: item.encodeTimeMs,
                });
                break;
            case 'Canceled':
                this.finish({
                    state: item.state,
                    isSucceeded: false,
                    sourcePath: this.srcPath,
                    outputPath: null,
                    outputPathBase: null,
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
     *
     * 進捗は**自分のタスクを実行しているコンソールの出力**から拾う。
     * `State.Progress` は使わない — あれはキュー全体の進み具合 (完了したアイテムの割合) で、
     * 個々のタスクの進捗ではないため、実行中もほとんど動かず値も実態と合わない。
     *
     * Amatsukaze の処理は 解析 → ロゴ/CM 検出 → エンコード → mux と段階が分かれており、
     * 百分率が出るのはエンコード段階だけ (`[60.7%] ...`)。それ以外の段階では
     * `1066フレーム完了 125.36fps` のように総数が分からない形でしか出ないので、
     * **拾えない間は直前の値を保つ** (0% へ戻すとバーが行き来して読めなくなる)
     * @param item: AmatsukazeQueueItem
     * @return number
     */
    private getEncodingPercent(item: AmatsukazeQueueItem): number {
        const lines = this.consoleTexts.get(item.consoleId) ?? [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const percent = AmatsukazeTaskWatcher.parseProgressPercent(lines[i]);
            if (percent !== null) {
                this.lastEncodingPercent = percent;

                return percent;
            }
        }

        return this.lastEncodingPercent;
    }

    /**
     * コンソール出力を行へ分ける。
     *
     * エンコーダの進捗行は改行ではなく CR で同じ行を上書きしていくため、
     * CR で分けないと複数回分の進捗が 1 行に繋がってしまう
     * (画面には最初の進捗が出続け、進捗の抽出も最初の値を読んでしまう)
     * @param lines: string[]
     * @return string[]
     */
    private static splitConsoleLines(lines: string[]): string[] {
        const result: string[] = [];
        for (const line of lines) {
            for (const part of line.split(/\r\n|\r|\n/)) {
                if (part.length > 0) {
                    result.push(part);
                }
            }
        }

        return result;
    }

    /**
     * エンコーダの進捗行から百分率 (0〜1) を取り出す。
     *
     * 進捗行は `[60.7%] 29701/48918 frames: ... GPU 21%, VD 58%` の形で、
     * **行頭の `[...%]` だけが進捗**。同じ行に GPU 使用率などの別の百分率が並ぶうえ、
     * 進捗と無関係な行にも `CPU: 10.8%` や `未出力フレーム: 43（0.050%）` が出るため、
     * 行内の百分率を拾うと進捗が飛ぶ
     * @param line: string
     * @return number | null 進捗行でない場合は null
     */
    private static parseProgressPercent(line: string): number | null {
        const matched = /^\s*\[(\d+(?:\.\d+)?)%\]/.exec(line);
        if (matched === null) {
            return null;
        }

        const percent = parseFloat(matched[1]) / 100;
        if (Number.isFinite(percent) === false) {
            return null;
        }

        return Math.min(Math.max(percent, 0), 1);
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
