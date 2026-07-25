import * as path from 'path';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as apid from '../../../../api';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel, { EncodeInfoItem, EncodeQueueInfo, EncodeRecordedIdIndex } from './IEncodeManageModel';
import IEncodeQueueStoreModel from './IEncodeQueueStoreModel';
import { EncodeOption, EncoderModelProvider, IEncoderModel } from './IEncoderModel';

@injectable()
class EncodeManageModel implements IEncodeManageModel {
    private log: ILogger;
    private executeManagementModel: IExecutionManagementModel;
    private encoderModelProvider: EncoderModelProvider;
    private encodeEvent: IEncodeEvent;
    private queueStore: IEncodeQueueStoreModel;
    private concurrentEncodeNum: number;
    private waitQueue: IEncoderModel[] = [];
    private runningQueue: IEncoderModel[] = [];
    private idCnt: number = 1;
    // プロセス枠不足によるリトライ回数を encodeId 単位で保持する
    private processShortageRetryCntMap: Map<apid.EncodeId, number> = new Map();

    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('EncoderModelProvider') encoderModelProvider: EncoderModelProvider,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @inject('IEncodeQueueStoreModel') queueStore: IEncodeQueueStoreModel,
    ) {
        this.log = logger.getLogger();
        this.executeManagementModel = executeManagementModel;
        this.concurrentEncodeNum = configure.getConfig().concurrentEncodeNum;
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;
        this.queueStore = queueStore;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.checkQueue.bind(this));
    }

    /**
     * 保存されているエンコードキューを復元する
     * Service プロセスの起動時に一度だけ呼び出す
     *
     * 実行中だったエンコードはプロセスごと失われているため、待機中として積み直す
     * @return Promise<void>
     */
    public async restore(): Promise<void> {
        if (this.concurrentEncodeNum <= 0) {
            return;
        }

        const stored = await this.queueStore.load();
        if (stored === null || stored.items.length === 0) {
            return;
        }

        for (const option of stored.items) {
            const encoder = await this.encoderModelProvider();
            encoder.setOption(option);
            this.waitQueue.push(encoder);

            // 払い出し済みの encodeId と衝突しないようにカウンタを進める
            if (option.encodeId >= this.idCnt) {
                this.idCnt = option.encodeId + 1;
            }
        }

        if (stored.idCnt > this.idCnt) {
            this.idCnt = stored.idCnt;
        }

        this.log.encode.info(`restore encode queue: ${this.waitQueue.length} items`);

        /**
         * クライアントへの通知は行わない
         * restore() は socket.io の初期化前 (Web API 待ち受け開始前) に呼ばれるため、
         * この時点で通知するとソケット未初期化のエラーになる
         * (クライアントは接続時に改めてエンコード情報を取得する)
         */
        this.emitNeedsCheckQueue();
    }

    /**
     * 未完了のエンコード情報 (実行中 + 待機中) をファイルへ保存する
     * 保存に失敗してもエンコード自体は継続させるため、エラーはログのみとする
     */
    private saveQueue(): void {
        const items: EncodeOption[] = [];
        for (const encoder of [...this.runningQueue, ...this.waitQueue]) {
            const option = encoder.getEncodeOption();
            if (option !== null) {
                items.push(option);
            }
        }

        this.queueStore
            .save({
                idCnt: this.idCnt,
                items: items,
            })
            .catch(err => {
                this.log.encode.error('save encode queue error');
                this.log.encode.error(err);
            });
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('CncurrentEncodeNumIsZero');
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);

        // encoder を生成する
        const encoder = await this.encoderModelProvider();
        const option = this.createEncodeOption(addOption);
        encoder.setOption(option);

        // queue に積む
        this.waitQueue.push(encoder);
        this.saveQueue();
        this.emitNeedsCheckQueue();

        this.log.encode.info(`add new encode: ${option.encodeId}`);

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitAddEncode(option.encodeId);

        return option.encodeId;
    }

    /**
     * エンコードオプションを生成する
     * @param baseOption: apid.AddEncodeProgramOption
     * @returns EncodeOption
     */
    private createEncodeOption(baseOption: apid.AddEncodeProgramOption): EncodeOption {
        // encoder のオプションを生成
        const encodeOption: EncodeOption = cloneDeep(baseOption) as any;
        const encodeId = this.idCnt;
        encodeOption.encodeId = encodeId;

        // idCnt をインクリメント
        if (this.idCnt === Number.MAX_SAFE_INTEGER) {
            this.idCnt = 0;
        }
        this.idCnt++;

        return encodeOption;
    }

    /**
     * queue の状態をチェックする必要がある場合に呼ぶ
     */
    private emitNeedsCheckQueue(): void {
        this.listener.emit(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT);
    }

    /**
     * queue をチェックする
     * @return Promise<void>
     */
    private async checkQueue(): Promise<void> {
        // 実行権取得
        // 取得に失敗 (タイムアウト) した場合は queue を放置すると誰もチェックしなくなるため、
        // 一定時間後に再度チェックを行わせる
        let exeId: string;
        try {
            exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CREATE_ENCODING_PROCESS_PRIPORITY);
        } catch (err: any) {
            this.log.encode.error('get execution error at checkQueue');
            this.log.encode.error(err);

            setTimeout(() => {
                this.emitNeedsCheckQueue();
            }, EncodeManageModel.CHECK_QUEUE_RETRY_INTERVAL);

            return;
        }

        // runningQueue がロック中 or 同時エンコード最大数に達している or waitQueue が空の場合はスルー
        if (this.runningQueue.length >= this.concurrentEncodeNum || this.waitQueue.length === 0) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // waitQueue から取り出す
        const encoder = this.waitQueue.shift();
        if (typeof encoder === 'undefined') {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // encodeOption が無い場合は何もしない
        const encodeOption = encoder.getEncodeOption();
        if (encodeOption === null) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);
            this.log.encode.warn('encodeOption is null'); // encoder 生成時にセットされているはずなので警告を出す

            return;
        }

        // runningQueue に積む
        this.runningQueue.push(encoder);

        // エンコード終了時の処理をセット
        // プロセス枠不足によるリトライ時は同一の encoder インスタンスを使い回すため、
        // 初回起動時 (= リトライ回数を保持していない) のみセットする。
        // encoder.setOnFinish() は内部で EventEmitter.once を使っており、
        // 呼び出す度にリスナーが積み増されてしまうため、多重登録を避ける必要がある。
        if (this.processShortageRetryCntMap.has(encodeOption.encodeId) === false) {
            encoder.setOnFinish((isError, outputFilePath) => {
                this.onFinish(isError, outputFilePath, encodeOption);
            });
        }

        // エンコードプロセス開始
        let needsFinalize = false;
        let isProcessShortageError = false;
        try {
            await encoder.start();
        } catch (err: any) {
            this.log.encode.error(`create encode process error: ${encoder.getEncodeId()}`);
            this.log.encode.error(err);

            if (typeof err?.message === 'string' && err.message === 'EncodeProcessManageModelCreateError') {
                // エンコードプロセスの枠不足が原因のエラー
                // (kill 可能な低優先度のプロセスが見つからなかった場合)
                // 設定ミスなどの恒久的なエラーではないため、破棄せずリトライする
                isProcessShortageError = true;
            } else {
                needsFinalize = true;

                // エラー通知
                this.encodeEvent.emitErrorEncode();
            }
        }

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        if (isProcessShortageError === true) {
            this.retryEncodeByProcessShortage(encoder, encodeOption);
        } else if (needsFinalize === true) {
            this.finalize(encodeOption.encodeId);
        } else {
            /**
             * checkQueue は 1 回の呼び出しで 1 件しか起動しないため、
             * 同時実行枠が複数空いている場合は続けてチェックを行わせる
             * (これを行わないと空き枠があるのに次のエンコードが開始されず、
             *  次の終了通知まで待たされてしまう)
             */
            this.emitNeedsCheckQueue();
        }
    }

    /**
     * プロセス枠不足でエンコード開始に失敗した encoder を waitQueue に戻し、
     * 一定時間後に再度キューのチェックを行わせる
     * リトライ回数が上限に達した場合は通常のエラーとして確定させる
     * @param encoder: IEncoderModel
     * @param encodeOption: EncodeOption
     */
    private retryEncodeByProcessShortage(encoder: IEncoderModel, encodeOption: EncodeOption): void {
        // runningQueue から取り除く
        this.runningQueue = this.runningQueue.filter(q => {
            return q.getEncodeId() !== encodeOption.encodeId;
        });

        const retryCnt = (this.processShortageRetryCntMap.get(encodeOption.encodeId) || 0) + 1;

        if (retryCnt > EncodeManageModel.MAX_PROCESS_SHORTAGE_RETRY_CNT) {
            // リトライ上限に達したのでエラーとして確定させる
            this.log.encode.error(
                `encode process create error: process slot shortage retry limit exceeded, giving up. encodeId: ${encodeOption.encodeId}`,
            );
            this.log.encode.error(`枠不足でリトライ上限に達したため中止: ${encodeOption.encodeId}`);

            this.processShortageRetryCntMap.delete(encodeOption.encodeId);

            // エラー通知
            this.encodeEvent.emitErrorEncode();

            this.finalize(encodeOption.encodeId);

            return;
        }

        this.processShortageRetryCntMap.set(encodeOption.encodeId, retryCnt);

        this.log.encode.warn(
            `encode process create error: 
            process slot shortage. retry ${retryCnt}/${EncodeManageModel.MAX_PROCESS_SHORTAGE_RETRY_CNT} 
            after ${EncodeManageModel.PROCESS_SHORTAGE_RETRY_INTERVAL}ms. encodeId: ${encodeOption.encodeId}`,
        );

        // waitQueue の先頭に戻す (他のジョブに順番を追い越されないようにするため unshift する)
        this.waitQueue.unshift(encoder);

        // 即時リトライするとプロセス枠が空くまでビジーループになるため、一定時間待ってから再チェックする
        setTimeout(() => {
            this.emitNeedsCheckQueue();
        }, EncodeManageModel.PROCESS_SHORTAGE_RETRY_INTERVAL);
    }

    /**
     * エンコード終了処理
     * @param isError: 異常終了か
     * @param outputFilePath: エンコードファイルパス
     * @param encodeOption: エンコードオプション
     */
    private onFinish(isError: boolean, outputFilePath: string | null, encodeOption: EncodeOption): void {
        if (isError) {
            // エラー通知
            this.encodeEvent.emitErrorEncode();
        } else {
            // 終了通知 DB に登録を依頼
            const fileName = outputFilePath === null ? null : path.basename(outputFilePath);
            if (
                encodeOption.removeOriginal === true &&
                this.hasSamVideoFileIdItem(encodeOption.sourceVideoFileId, encodeOption.encodeId) === true
            ) {
                // queue に削除予定の videofile が存在するので、削除しないように false にする
                encodeOption.removeOriginal = false;
            }

            this.encodeEvent.emitFinishEncode({
                recordedId: encodeOption.recordedId,
                videoFileId: encodeOption.sourceVideoFileId,
                parentDirName: encodeOption.parentDir,
                filePath:
                    outputFilePath === null || fileName === null
                        ? null
                        : typeof encodeOption.directory === 'undefined'
                          ? fileName
                          : path.join(encodeOption.directory, fileName),
                fullOutputPath: outputFilePath,
                mode: encodeOption.mode,
                removeOriginal: encodeOption.removeOriginal,
            });
        }

        // 終了処理
        this.finalize(encodeOption.encodeId);
    }

    /**
     * videoFileId で指定した video file id を持つ queue item が存在するか調べる
     * @param videoFileId: apid.VideoFileId
     * @param excludeEncodeId: apid.EncodeId 除外する encode id
     * @return boolean 存在するなら true を返す
     */
    private hasSamVideoFileIdItem(videoFileId: apid.VideoFileId, excludeEncodeId: apid.EncodeId): boolean {
        const runningItem = this.runningQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof runningItem !== 'undefined') {
            return true;
        }

        const waitItem = this.waitQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof waitItem !== 'undefined') {
            return true;
        }

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);

        // runningQueue から encodeId の要素を削除する
        this.runningQueue = this.runningQueue.filter(q => {
            return q.getEncodeId() !== encodeId;
        });

        // プロセス枠不足のリトライ回数情報をクリアする
        this.processShortageRetryCntMap.delete(encodeId);

        // 完了した分を除いた queue を保存する
        this.saveQueue();

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        process.nextTick(() => {
            this.emitNeedsCheckQueue();
        });
    }

    /**
     * 指定された encode id を queue から削除する
     * @param encodeId: apid.EncodeId
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CANCEL_ENCODE_PRIPORITY);

        this.log.encode.info(`cancel encode: ${encodeId}`);

        // runningQueue にあるので プロセスを殺す
        const runningQueueItem = this.getRunnginQueueItem(encodeId);
        if (typeof runningQueueItem !== 'undefined') {
            await runningQueueItem.cancel();
        } else {
            // waitQueue から削除
            // プロセス枠不足でリトライ待ちの状態で waitQueue に戻されているジョブも
            // ここで削除されるため、キャンセル後に復活することはない
            this.waitQueue = this.waitQueue.filter(q => {
                return q.getEncodeId() !== encodeId;
            });

            // プロセス枠不足のリトライ回数情報をクリアする
            this.processShortageRetryCntMap.delete(encodeId);

            // キャンセルした分を除いた queue を保存する
            this.saveQueue();

            process.nextTick(() => {
                this.emitNeedsCheckQueue();
            });
        }

        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitCancelEncode(encodeId);
    }

    /**
     * 指定した encodeId を runningQueue から取り出す
     * @param encodeId: apid.EncodeId
     * @return IEncoderModel | undefined
     */
    private getRunnginQueueItem(encodeId: apid.EncodeId): IEncoderModel | undefined {
        return this.runningQueue.find(q => {
            return q.getEncodeId() === encodeId;
        });
    }

    /**
     * queu に積まれている要素の recorded id の索引を返す
     */
    public getRecordedIndex(): EncodeRecordedIdIndex {
        const index: EncodeRecordedIdIndex = {};

        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        return index;
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const encodeIds: apid.EncodeId[] = [];

        // recordedId に該当する encodedId を取り出す
        // wait queue
        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // running queue
        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // 取り出した encodedId を元にキャンセル指示を出す
        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.encode.error(`cancel encode failed: ${encodeId}`);
                this.log.encode.error(err);
            });
        }

        // キャンセルに失敗した場合はエラーを履く
        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public getEncodeInfo(): EncodeQueueInfo {
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
        };

        // running queue
        for (const i of this.runningQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            const result: EncodeInfoItem = {
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            };

            const progress = i.getProgressInfo();
            if (progress !== null) {
                result.percent = progress.percent;
                result.log = progress.log;
            }

            queueInfo.runningQueue.push(result);
        }

        // wait queue
        for (const i of this.waitQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            queueInfo.waitQueue.push({
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            });
        }

        return queueInfo;
    }
}

namespace EncodeManageModel {
    export const UNLOCK_EVENT = 'unlockEvent';
    export const UNLOCK_TIMEOUT = 1000 * 60;
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
    // プロセス枠不足でエンコード開始に失敗した際のリトライ間隔 (ms)
    export const PROCESS_SHORTAGE_RETRY_INTERVAL = 1000 * 30;
    // プロセス枠不足でエンコード開始に失敗した際の最大リトライ回数
    export const MAX_PROCESS_SHORTAGE_RETRY_CNT = 5;
    // 実行権の取得に失敗した際に queue を再チェックするまでの間隔 (ms)
    export const CHECK_QUEUE_RETRY_INTERVAL = 1000 * 10;
}

export default EncodeManageModel;
