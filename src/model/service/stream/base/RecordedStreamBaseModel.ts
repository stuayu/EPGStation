import { ChildProcess, exec } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import internal, { Readable } from 'stream';
import ID3MetadataTransform from 'arib-subtitle-timedmetadater';
import * as apid from '../../../../../api';
import * as fst from '../../../../lib/TailStream';
import ProcessUtil from '../../../../util/ProcessUtil';
import IVideoUtil from '../../../api/video/IVideoUtil';
import IRecordedDB from '../../../db/IRecordedDB';
import IVideoFileDB from '../../../db/IVideoFileDB';
import IConfiguration from '../../../IConfiguration';
import ILoggerModel from '../../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../../encode/IEncodeProcessManageModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import AribId3Extractor from '../llhls/AribId3Extractor';
import Fmp4Packager from '../llhls/Fmp4Packager';
import IAribId3Extractor from '../llhls/IAribId3Extractor';
import IFmp4Packager from '../llhls/IFmp4Packager';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IHLSMemoryStoreModel from '../util/IHLSMemoryStoreModel';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel';
import { RecordedStreamInfo } from './IStreamBaseModel';
import StreamBaseModel from './StreamBaseModel';

@injectable()
export default abstract class RecordedStreamBaseModel
    extends StreamBaseModel<RecordedStreamOption>
    implements IRecordedStreamBaseModel
{
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private hlsMemoryStore: IHLSMemoryStoreModel;

    private fileStream: Readable | null = null;
    private id3MetadataTransoform: ID3MetadataTransform | null = null;
    private streamProcess: ChildProcess | null = null;
    private videoFilePath: string | null = null;
    private videoFileInfo: VideoFileInfo | null = null;
    private videoFileType: apid.VideoFileType = 'encoded';
    private isRecording: boolean = false;
    private fmp4Packager: IFmp4Packager | null = null;
    // in-memory HLS で ARIB 字幕 (ID3 timed metadata) を取り出すための Transform
    private aribId3Extractor: IAribId3Extractor | null = null;
    private memoryStreamId: apid.StreamId | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IStreamProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IHLSMemoryStoreModel') hlsMemoryStore: IHLSMemoryStoreModel,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.hlsMemoryStore = hlsMemoryStore;
    }

    /**
     * in-memory HLS (ディスクに書き出さない fMP4 HLS 配信) モードか判定する
     * cmd が %streamFileDir% を含まない RecordedHLS プロファイルは、
     * fragmented MP4 を標準出力 (pipe:1) へ書き出すコマンドとみなす
     * (ライブ HLS の LiveStreamBaseModel.isMemoryHLS() と同じ判定)
     */
    private isMemoryHLS(): boolean {
        return (
            this.getStreamType() === 'RecordedHLS' &&
            this.processOption !== null &&
            this.processOption.cmd.includes('%streamFileDir%') === false
        );
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    /**
     * ストリーム開始
     * @return Promise<void>
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        // HLS stream ディレクトリ使用準備 (in-memory モードではディスクを一切使わない)
        if (this.getStreamType() === 'RecordedHLS' && this.isMemoryHLS() === false) {
            await this.prepStreamDir(streamId);
        }

        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.setVideFileInfo();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            throw new Error('OutOfRange');
        }

        // file read stream の生成
        try {
            this.setFileStream();
        } catch (err: any) {
            this.log.stream.error('create file stream error');
            this.log.stream.error(err);
            await this.stop();
            throw new Error('FileStreamSetError');
        }

        // エンコードプロセス生成
        const poption = await this.createProcessOption(streamId);
        this.log.stream.info(`create encode process: ${poption.cmd}`);
        try {
            this.streamProcess = await this.processManager.create(poption);
        } catch (err: any) {
            this.log.stream.error(`create encode process failed: ${poption.cmd}`);
            await this.stop();
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        // process 終了時にイベントを発行する
        // in-memory モードはディスク上のファイルが増えないため startCheckStreamEnable が使えず、
        // プロセスの exit/error を直接監視する必要がある (ライブ HLS の in-memory モードと同様)
        if (this.getStreamType() !== 'RecordedHLS' || this.isMemoryHLS() === true) {
            this.streamProcess.on('exit', () => {
                this.emitExitStream();
            });
            this.streamProcess.on('error', () => {
                this.emitExitStream();
            });
        }
        if (this.getStreamType() === 'RecordedHLS') {
            if (this.isMemoryHLS() === true) {
                // エンコードプロセスの fMP4 出力をメモリ上で HLS セグメント化する
                this.startMemoryHLSPackaging(streamId);
            } else {
                // stream 有効チェク開始
                this.startCheckStreamEnable(streamId);
            }
        }
        // stream 停止タイマーセット
        this.setStopTimer();

        // ffmpeg debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        // パイプ処理
        if (this.streamProcess.stdin !== null && this.fileStream !== null) {
            // ts が入力かつ HLS 配信の場合は ARIB 字幕を ID3 timed metadata へ変換する
            // arib-subtitle-timedmetadater を通す (エンコード済みファイルには ARIB 字幕が含まれない)
            if (this.videoFileType === 'ts' && this.getStreamType() === 'RecordedHLS') {
                this.log.stream.info('use arib-subtitle-timedmetadater');
                this.id3MetadataTransoform = new ID3MetadataTransform();
                this.fileStream.pipe(this.id3MetadataTransoform);

                if (this.isMemoryHLS() === true) {
                    // in-memory (fMP4) モードでは mp4 出力に ID3 timed metadata を乗せられないため、
                    // エンコード前の TS から ID3 を抜き取り、セグメントの emsg box として再多重化する
                    this.aribId3Extractor = new AribId3Extractor(this.log);
                    this.id3MetadataTransoform.pipe(this.aribId3Extractor);
                    this.aribId3Extractor.pipe(this.streamProcess.stdin);
                } else {
                    this.id3MetadataTransoform.pipe(this.streamProcess.stdin);
                }
            } else {
                this.fileStream.pipe(this.streamProcess.stdin);
            }
        }

        // プロセスが即時終了していた場合
        if (ProcessUtil.isExited(this.streamProcess) === true) {
            this.streamProcess.removeAllListeners();
            this.emitExitStream();
        }
    }

    /**
     * in-memory HLS のパッケージングを開始する
     * エンコードプロセスが標準出力へ書き出す fragmented MP4 を Fmp4Packager で
     * init / セグメントに分解し、HLSMemoryStoreModel へ蓄積する (ディスク書き込みなし)
     * @param streamId: apid.StreamId
     */
    private startMemoryHLSPackaging(streamId: apid.StreamId): void {
        if (this.streamProcess === null || this.streamProcess.stdout === null) {
            throw new Error('StreamProcessStdoutIsNull');
        }

        this.log.stream.info(`start in-memory recorded HLS packaging: ${streamId}`);
        this.memoryStreamId = streamId;
        this.hlsMemoryStore.create(streamId);

        const packager = new Fmp4Packager({ partsPerSegment: 1 }, this.log);
        this.fmp4Packager = packager;

        packager.on('init', data => {
            this.hlsMemoryStore.setInit(streamId, data);
        });
        packager.on('segment', segment => {
            this.hlsMemoryStore.addSegment(streamId, segment.data, segment.duration);
            if (this.isEnable() === false && this.hlsMemoryStore.isReady(streamId) === true) {
                this.markEnable(streamId);
            }
        });
        packager.on('halted', message => {
            this.log.stream.error(`in-memory recorded HLS packaging halted: ${streamId} ${message}`);
            this.emitExitStream();
        });

        // エンコード前の TS から抜き取った ID3 timed metadata (ARIB 字幕) をセグメントへ乗せる
        if (this.aribId3Extractor !== null) {
            this.aribId3Extractor.on('id3', metadata => {
                packager.pushId3(metadata);
            });
        }

        this.streamProcess.stdout.pipe(packager);
    }

    /**
     * video file 情報を格納する
     * @return Promise<void>
     */
    private async setVideFileInfo(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const video = await this.videoFileDB.findId(this.processOption.videoFileId);
        if (video === null) {
            throw new Error('VideoIsNull');
        }

        // recorded 情報セット
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        this.isRecording = recorded.isRecording;

        // videoFilePath セット
        this.videoFilePath = await this.videoUtil.getFullFilePathFromId(video.id);
        if (this.videoFilePath === null) {
            throw new Error('GetVideoFilePathError');
        }

        // videoFileInfo セット
        this.videoFileInfo = await this.getVideoInfo(this.videoFilePath);

        this.videoFileType = video.type as apid.VideoFileType;
    }

    /**
     * 指定されたファイルパスのビデオ情報を取得する
     * @param filePath: string
     * @return Promise<VideoFileInfo>
     */
    private getVideoInfo(filePath: string): Promise<VideoFileInfo> {
        return new Promise<VideoFileInfo>((resolve, reject) => {
            exec(`${this.config.ffprobe} -v 0 -show_format -of json "${filePath}"`, (err, std) => {
                if (err) {
                    reject(err);

                    return;
                }
                const result = <any>JSON.parse(std);

                resolve({
                    duration: parseFloat(result.format.duration),
                    size: parseInt(result.format.size, 10),
                    bitRate: parseFloat(result.format.bit_rate),
                });
            });
        });
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return Promise<CreateProcessOption>
     */
    private async createProcessOption(streamId: apid.StreamId): Promise<CreateProcessOption> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%SS%/g, this.videoFileType === 'ts' ? '' : this.processOption.playPosition.toString(10));

        if (this.getStreamType() === 'RecordedHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, streamId.toString(10));
        }

        const option: CreateProcessOption = {
            input: this.isRecording === true ? null : this.videoFilePath,
            output:
                this.getStreamType() === 'RecordedHLS' && this.isMemoryHLS() === false
                    ? `${this.config.streamFilePath}\/stream${streamId.toString(10)}.m3u8`
                    : null,
            cmd: cmd,
            priority: RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };

        return option;
    }

    /**
     * fileStream をセットする
     */
    private setFileStream(): void {
        if (this.processOption === null || this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('VideoFileError');
        }

        // エンコードファイルなら何もしない
        if (this.videoFileType === 'encoded') {
            return;
        }

        this.log.stream.info(`create file stream: ${this.videoFilePath}`);
        const start = Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition);
        if (this.isRecording === true) {
            this.fileStream = fst.createReadStream(this.videoFilePath, {
                start: start,
            });
        } else {
            this.fileStream = fs.createReadStream(this.videoFilePath, {
                start: start,
            });
        }
    }

    /**
     * ストリームを停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        await super.stop();

        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
        }

        if (this.aribId3Extractor !== null) {
            this.aribId3Extractor.unpipe();
            this.aribId3Extractor.removeAllListeners();
            this.aribId3Extractor.destroy();
            this.aribId3Extractor = null;
        }

        if (this.id3MetadataTransoform !== null) {
            this.id3MetadataTransoform.unpipe();
            this.id3MetadataTransoform.destroy();
            this.id3MetadataTransoform = null;
        }

        if (this.fmp4Packager !== null) {
            if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
                this.streamProcess.stdout.unpipe();
            }
            this.fmp4Packager.destroy();
            this.fmp4Packager = null;
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess);
        }

        if (this.getStreamType() === 'RecordedHLS') {
            if (this.isMemoryHLS() === true) {
                if (this.memoryStreamId !== null) {
                    this.hlsMemoryStore.delete(this.memoryStreamId);
                    this.memoryStreamId = null;
                }
            } else {
                await this.fileDeleter.deleteAllFiles();
            }
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return RecordedStreamInfo
     */
    public getInfo(): RecordedStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.configMode === null) {
            throw new Error('ConfigModeIsNull');
        }

        return {
            type: this.getStreamType(),
            mode: this.configMode,
            videoFileId: this.processOption.videoFileId,
            isEnable: this.isEnable(),
        };
    }

    protected abstract getStreamType(): 'RecordedStream' | 'RecordedHLS';
}
