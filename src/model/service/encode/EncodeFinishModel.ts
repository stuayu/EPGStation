import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import IVideoFileAnalyzeModel from '../../video/IVideoFileAnalyzeModel';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel';
import IEncodeFinishModel from './IEncodeFinishModel';

@injectable()
export default class EncodeFinishModel implements IEncodeFinishModel {
    private log: ILogger;
    private socket: ISocketIOManageModel;
    private ipc: IIPCClient;
    private encodeEvent: IEncodeEvent;
    private videoFileAnalyzeModel: IVideoFileAnalyzeModel;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socket: ISocketIOManageModel,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @inject('IVideoFileAnalyzeModel') videoFileAnalyzeModel: IVideoFileAnalyzeModel,
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
        this.videoFileAnalyzeModel = videoFileAnalyzeModel;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setFinishEncode(this.finishEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
    }

    /**
     * エンコード追加処理
     * @param encodeId
     */
    private addEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコードキャンセル処理
     * @param encodeId
     */
    private cancelEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード終了処理
     * @param info: FinishEncodeInfo
     */
    private async finishEncode(info: FinishEncodeInfo): Promise<void> {
        let newVideoFileId: apid.VideoFileId | null = null;
        try {
            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                // add encode file
                // video_file.type はストリーミングパイプラインの選択にも使われる ('ts' = 生の
                // 放送 TS を前提にしたパイプ入力・yadif 有りの変換経路、'encoded' = 既に処理済みで
                // シーク可能なファイルの経路)。tsreplace 系 (出力が .ts のまま PSI/SI を保持) も
                // 実体は「エンコード済みで seek 可能なファイル」なので、拡張子に関わらず
                // 常に 'encoded' として登録する (TS 解析の対象判定は拡張子で別途行う)
                const id = await this.ipc.recorded.addVideoFile({
                    recordedId: info.recordedId,
                    parentDirectoryName: info.parentDirName,
                    filePath: info.filePath,
                    type: 'encoded',
                    name: info.mode,
                });
                newVideoFileId = id;

                // addVideoFile() は DB 登録だけで、エンコード後の実ファイルは解析しない。
                // tsreplace 出力の startAt は TDT/TOT + PCR/PTS から「再生位置 0 秒の実時刻」を
                // 求める必要があるため、登録直後に TS/ffprobe 解析を実行する。
                // mp4/mkv 等は TS 解析が自動でスキップされ、ffprobe メタデータだけ保存される。
                await this.videoFileAnalyzeModel.analyzeAll(id);

                // 既存サムネイルを削除し、エンコード出力から同じ録画のサムネイルを生成する。
                await this.ipc.thumbnail.replaceRecorded(info.recordedId, id);
            }
        } catch (err: any) {
            this.log.encode.error('finish encode error');
            this.log.encode.error(err);
        }

        if (info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();

        // Operator にイベントを転送
        await this.ipc.encodeEvent.emitFinishEncode({
            recordedId: info.recordedId,
            videoFileId: newVideoFileId,
            mode: info.mode,
        });
    }

    /**
     * エンコード失敗処理
     */
    private errorEncode(): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード進捗情報更新
     */
    private updateEncodeProgress(): void {
        this.socket.notifyUpdateEncodeProgress();
    }
}
