import { ChildProcess } from 'child_process';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import internal from 'stream';
import ID3MetadataTransform from 'arib-subtitle-timedmetadater';
import * as apid from '../../../../../api';
import ProcessUtil from '../../../../util/ProcessUtil';
import IConfigFile from '../../../IConfigFile';
import IConfiguration from '../../../IConfiguration';
import ILoggerModel from '../../../ILoggerModel';
import IMirakurunClientModel from '../../../IMirakurunClientModel';
import BitCollectTransform from '../../../channel/BitCollectTransform';
import IBroadcastAffiliationCollector from '../../../channel/IBroadcastAffiliationCollector';
import IEncodeProcessManageModel, { CreateProcessOption } from '../../encode/IEncodeProcessManageModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import AribId3Extractor from '../llhls/AribId3Extractor';
import BroadcastTimeExtractor from '../util/BroadcastTimeExtractor';
import IBroadcastTimeExtractor from '../util/IBroadcastTimeExtractor';
import Fmp4Packager from '../llhls/Fmp4Packager';
import IAribId3Extractor from '../llhls/IAribId3Extractor';
import IFmp4Packager from '../llhls/IFmp4Packager';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IHLSMemoryStoreModel from '../util/IHLSMemoryStoreModel';
import ILiveStreamBaseModel, { LiveStreamOption } from './ILiveStreamBaseModel';
import { LiveStreamInfo } from './IStreamBaseModel';
import StreamBaseModel from './StreamBaseModel';

@injectable()
export default abstract class LiveStreamBaseModel
    extends StreamBaseModel<LiveStreamOption>
    implements ILiveStreamBaseModel
{
    private stream: http.IncomingMessage | null = null;
    private streamProcess: ChildProcess | null = null;
    private mirakurunClientModel: IMirakurunClientModel;
    private id3MetadataTransoform: ID3MetadataTransform | null = null;
    private hlsMemoryStore: IHLSMemoryStoreModel;
    private fmp4Packager: IFmp4Packager | null = null;
    // in-memory HLS で ARIB 字幕 (ID3 timed metadata) を取り出すための Transform
    private aribId3Extractor: IAribId3Extractor | null = null;
    // 配信中の映像の放送時刻 (TDT / TOT) を読み取る。実況コメントの遅延補正に使う
    private broadcastTimeExtractor: IBroadcastTimeExtractor | null = null;
    // 配信中の TS から BIT (放送局の系列情報) を収集する
    private affiliationCollector: IBroadcastAffiliationCollector;
    private bitCollectTransform: BitCollectTransform | null = null;
    private memoryStreamId: apid.StreamId | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IStreamProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IHLSMemoryStoreModel') hlsMemoryStore: IHLSMemoryStoreModel,
        @inject('IBroadcastAffiliationCollector') affiliationCollector: IBroadcastAffiliationCollector,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.mirakurunClientModel = mirakurunClientModel;
        this.hlsMemoryStore = hlsMemoryStore;
        this.affiliationCollector = affiliationCollector;
    }

    /**
     * in-memory HLS (ディスクに書き出さない fMP4 HLS 配信) モードか判定する
     * cmd が %streamFileDir% を含まない LiveHLS プロファイルは、
     * fragmented MP4 を標準出力 (pipe:1) へ書き出すコマンドとみなす
     */
    private isMemoryHLS(): boolean {
        return (
            this.getStreamType() === 'LiveHLS' &&
            this.processOption !== null &&
            typeof this.processOption.cmd !== 'undefined' &&
            this.processOption.cmd.includes('%streamFileDir%') === false
        );
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @param streamId: apid.StreamId
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    protected createProcessOption(streamId: apid.StreamId): CreateProcessOption | null {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        /**
         * mirakurun の stream をそのまま横流しする
         */
        if (typeof this.processOption.cmd === 'undefined') {
            return null;
        }

        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%TSREADEX%/g, typeof this.config.tsreadex === 'undefined' ? 'tsreadex' : this.config.tsreadex);
        if (this.getStreamType() === 'LiveHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, streamId.toString(10));
        }

        return {
            input: null,
            output:
                this.getStreamType() === 'LiveHLS' && this.isMemoryHLS() === false
                    ? `${this.config.streamFilePath}\/stream${streamId}.m3u8`
                    : null,
            cmd: cmd,
            priority: LiveStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        // HLS stream ディレクトリ使用準備 (in-memory モードではディスクを一切使わない)
        if (this.getStreamType() === 'LiveHLS' && this.isMemoryHLS() === false) {
            await this.prepStreamDir(streamId);
        }

        // 放送波受信
        await this.setMirakurunStream(this.config);
        if (this.stream === null) {
            throw new Error('SetStreamError');
        }

        // エンコードプロセスの生成が必要かチェック
        const poption = this.createProcessOption(streamId);
        if (poption !== null) {
            // エンコードプロセス生成
            this.log.stream.info(`create encode process: ${poption.cmd}`);
            this.streamProcess = await this.processManager.create(poption).catch(err => {
                if (this.stream !== null) {
                    this.stream.unpipe();
                    this.stream.destroy();
                }

                this.log.stream.error(`create encode process failed: ${poption.cmd}`);
                throw err;
            });

            // process 終了にイベントを発行する
            this.streamProcess.on('exit', () => {
                this.emitExitStream();
            });
            this.streamProcess.on('error', () => {
                this.emitExitStream();
            });

            // ffmpeg debug 用ログ出力
            if (this.streamProcess.stderr !== null) {
                this.streamProcess.stderr.on('data', data => {
                    this.log.stream.debug(String(data));
                });
            }

            // パイプ処理
            if (this.streamProcess.stdin !== null) {
                // 実況コメントの遅延補正のため、エンコード前の TS から放送時刻 (TDT / TOT) を読む
                this.broadcastTimeExtractor = new BroadcastTimeExtractor(this.log);
                this.stream.pipe(this.broadcastTimeExtractor);

                // 放送局の系列情報 (BIT) を配信のついでに収集する
                this.bitCollectTransform = new BitCollectTransform(this.affiliationCollector, this.log);
                this.broadcastTimeExtractor.pipe(this.bitCollectTransform);
                const tsSource = this.bitCollectTransform;

                // ARIB 字幕を ID3 timed metadata へ変換する (arib-subtitle-timedmetadater)。
                // HLS だけでなく mpegts 配信 (m2ts / m2tsll) でも必要:
                // DPlayer は mpegts.js の TIMED_ID3_METADATA_ARRIVED からしか aribb24 へ字幕を渡さないため、
                // ARIB 字幕 ES をそのまま流しても字幕は表示されない
                this.log.stream.info('use arib-subtitle-timedmetadater');
                this.id3MetadataTransoform = new ID3MetadataTransform();
                tsSource.pipe(this.id3MetadataTransoform);

                if (this.getStreamType() === 'LiveHLS' && this.isMemoryHLS() === true) {
                    // in-memory (fMP4) モードでは mp4 出力に ID3 timed metadata を乗せられないため、
                    // エンコード前の TS から ID3 を抜き取り、セグメントの emsg box として再多重化する
                    this.aribId3Extractor = new AribId3Extractor(this.log);
                    this.id3MetadataTransoform.pipe(this.aribId3Extractor);
                    this.aribId3Extractor.pipe(this.streamProcess.stdin);
                } else {
                    this.id3MetadataTransoform.pipe(this.streamProcess.stdin);
                }
            } else {
                await this.stop();

                throw new Error('StreamProcessStdinIsNull');
            }

            if (this.getStreamType() === 'LiveHLS') {
                if (this.isMemoryHLS() === true) {
                    // エンコードプロセスの fMP4 出力をメモリ上で HLS セグメント化する
                    this.startMemoryHLSPackaging(streamId);
                } else {
                    // stream 有効チェク開始
                    this.startCheckStreamEnable(streamId);
                }
            }

            // プロセスが即時終了していた場合
            if (ProcessUtil.isExited(this.streamProcess) === true) {
                this.streamProcess.removeAllListeners();
                this.emitExitStream();
            }
        } else {
            // stream 停止処理時にイベントを発行する
            this.stream.on('close', () => {
                this.emitExitStream();
            });
            this.stream.on('end', () => {
                this.emitExitStream();
            });
            this.stream.on('error', () => {
                this.emitExitStream();
            });
        }

        // stream 停止タイマーセット
        this.setStopTimer();
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

        this.log.stream.info(`start in-memory HLS packaging: ${streamId}`);
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
            this.log.stream.error(`in-memory HLS packaging halted: ${streamId} ${message}`);
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
     * 放送波受信
     * @param config: IConfigFile
     * @return Promise<void>
     */
    private async setMirakurunStream(config: IConfigFile): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const mirakurun = this.mirakurunClientModel.getClient();
        mirakurun.priority = config.streamingPriority;

        this.log.stream.info(`get mirakurun service stream: ${this.processOption.channelId}`);
        this.stream = await mirakurun
            .getServiceStream(this.processOption.channelId, true, config.streamingPriority)
            .catch(err => {
                this.stream = null;
                if (this.processOption !== null) {
                    this.log.system.error(`get mirakurun service stream failed: ${this.processOption.channelId}`);
                }
                throw err;
            });
    }

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        await super.stop();

        if (this.stream !== null) {
            this.stream.unpipe();
            this.stream.destroy();
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

        if (this.bitCollectTransform !== null) {
            this.bitCollectTransform.unpipe();
            this.bitCollectTransform.destroy();
            this.bitCollectTransform = null;
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

        if (this.getStreamType() === 'LiveHLS') {
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
        } else if (this.stream !== null) {
            return this.stream;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return LiveStreamInfo
     */
    public getInfo(): LiveStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.configMode === null) {
            throw new Error('ConfigModeIsNull');
        }

        const info: LiveStreamInfo = {
            type: this.getStreamType(),
            mode: this.configMode,
            channelId: this.processOption.channelId,
            isEnable: this.isEnable(),
        };

        const broadcastTime = this.broadcastTimeExtractor?.getBroadcastTime() ?? null;
        if (broadcastTime !== null) {
            info.broadcastTime = broadcastTime;
        }

        return info;
    }

    protected abstract getStreamType(): 'LiveStream' | 'LiveHLS';
}
