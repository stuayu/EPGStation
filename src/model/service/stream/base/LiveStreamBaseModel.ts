import { ChildProcess } from 'child_process';
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
import IEitPresentStore from '../util/IEitPresentStore';
import EitPresentCollectTransform from '../util/EitPresentCollectTransform';
import Fmp4Packager from '../llhls/Fmp4Packager';
import IAribId3Extractor from '../llhls/IAribId3Extractor';
import IFmp4Packager, { Fmp4PackagerTrackRole } from '../llhls/IFmp4Packager';
import AudioTrackUtil from '../util/AudioTrackUtil';
import ISourceAnalyzer from '../../../stream/capability/ISourceAnalyzer';
import { replaceDeinterlacePlaceholder, toDeinterlaceInput } from '../../../../util/DeinterlaceUtil';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IHLSMemoryStoreModel, { HLSMemoryTrackRole } from '../util/IHLSMemoryStoreModel';
import ILiveStreamBaseModel, { LiveStreamOption } from './ILiveStreamBaseModel';
import { LiveStreamInfo } from './IStreamBaseModel';
import StreamBaseModel from './StreamBaseModel';
import ILiveStreamSourceManageModel, { LiveStreamSourceLease } from '../manager/ILiveStreamSourceManageModel';

@injectable()
export default abstract class LiveStreamBaseModel
    extends StreamBaseModel<LiveStreamOption>
    implements ILiveStreamBaseModel
{
    // in-memory ライブ HLS の 1 セグメントを構成するパート数
    // 1 パート = fMP4 フラグメント = GOP (EncodePresets の LIVE_HLS_GOP_FRAMES で 0.5 秒) なので、
    // 2 パートで 1 秒セグメントになる (#EXT-X-TARGETDURATION は 1 秒が下限)
    private static readonly LIVE_HLS_PARTS_PER_SEGMENT = 2;

    private stream: internal.Readable | null = null;
    private mirakurunStreamLease: LiveStreamSourceLease | null = null;
    private streamProcess: ChildProcess | null = null;
    // 旧テスト/外部組み立てとの互換用。通常は共有ソース manager を使う
    private mirakurunClientModel: IMirakurunClientModel;
    private liveStreamSourceManageModel: ILiveStreamSourceManageModel | undefined;
    private isNormalizedByTsreadex: boolean = false;
    private id3MetadataTransoform: ID3MetadataTransform | null = null;
    // m2tsll (および tsreadex 経由の m2ts) で使う、エンコード後に ID3 を挿入する Transform。
    // 入力側へ ID3 を map せず、出力側 (streamProcess.stdout) へ挿入する
    private id3OutputTransform: ID3MetadataTransform | null = null;
    private hlsMemoryStore: IHLSMemoryStoreModel;
    private fmp4Packager: IFmp4Packager | null = null;
    // in-memory HLS で ARIB 字幕 (ID3 timed metadata) を取り出すための Transform
    private aribId3Extractor: IAribId3Extractor | null = null;
    // 配信中の映像の放送時刻 (TDT / TOT) を読み取る。実況コメントの遅延補正に使う
    private broadcastTimeExtractor: IBroadcastTimeExtractor | null = null;
    // 配信中の TS から EIT[p/f] を読み、放送中番組の判定に使う
    private eitPresentCollectTransform: EitPresentCollectTransform | null = null;
    // 配信中の TS から BIT (放送局の系列情報) を収集する
    private affiliationCollector: IBroadcastAffiliationCollector;
    private bitCollectTransform: BitCollectTransform | null = null;
    private memoryStreamId: apid.StreamId | null = null;
    private eitPresentStore: IEitPresentStore;
    // 複数音声トラック分解モードで実際に使われたロール (音声 1 本のみなら null のまま)
    private multiTrackRoles: Fmp4PackagerTrackRole[] | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IStreamProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IHLSMemoryStoreModel') hlsMemoryStore: IHLSMemoryStoreModel,
        @inject('IBroadcastAffiliationCollector') affiliationCollector: IBroadcastAffiliationCollector,
        @inject('IEitPresentStore') eitPresentStore: IEitPresentStore,
        @inject('ILiveStreamSourceManageModel') liveStreamSourceManageModel?: ILiveStreamSourceManageModel,
        @inject('ISourceAnalyzer') sourceAnalyzer?: ISourceAnalyzer,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.mirakurunClientModel = mirakurunClientModel;
        this.liveStreamSourceManageModel = liveStreamSourceManageModel;
        this.hlsMemoryStore = hlsMemoryStore;
        this.affiliationCollector = affiliationCollector;
        this.eitPresentStore = eitPresentStore;
        this.sourceAnalyzer = sourceAnalyzer;
    }

    private sourceAnalyzer: ISourceAnalyzer | undefined;

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
     * ID3 timed metadata (ARIB 字幕) の挿入をエンコード後 (ffmpeg 出力) 側で行うか判定する
     *
     * m2tsll は ID3 timed metadata (PID 0x1FFE) を入力側へ map すると、字幕が疎な区間で
     * mpegts muxer のインターリーブ待ちが発生する。そのため入力側への挿入を行わず、
     * エンコード後の TS (ARIB 字幕 ES を `-c:s copy` 済み) へ挿入し直す。
     * tsreadex 経由の m2ts (m2tsll 以外) も従来どおり対象とする。mp4 / webm / HLS
     * (ディスク・in-memory とも) は対象外 (mpegts 以外へは挿入できない、
     * または in-memory HLS は別経路の AribId3Extractor が担う)
     */
    private useOutputSideId3(): boolean {
        return (
            this.processOption !== null &&
            (this.processOption.container === 'm2tsll' ||
                (this.isNormalizedByTsreadex === true && this.processOption.container === 'm2ts'))
        );
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @param streamId: apid.StreamId
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    protected async createProcessOption(streamId: apid.StreamId): Promise<CreateProcessOption | null> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        /**
         * mirakurun の stream をそのまま横流しする
         */
        if (typeof this.processOption.cmd === 'undefined') {
            return null;
        }

        // tsreadex を通す cmd はデュアルモノラルが 2 本の音声 ES へ分離済みなので、
        // 副音声の選び方が変わる (置換前の cmd で判定する。%TSREADEX% は下で消える)
        const isNormalizedByTsreadex = this.processOption.cmd.includes('%TSREADEX%');
        this.isNormalizedByTsreadex = isNormalizedByTsreadex;
        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%TSREADEX%/g, typeof this.config.tsreadex === 'undefined' ? 'tsreadex' : this.config.tsreadex);
        cmd = await this.resolveDeinterlace(cmd);
        // 音声トラック指定・フィルタ (%DUALMONOMODE% / %AUDIOMAP% / %AUDIOFILTER%) を展開する
        cmd = AudioTrackUtil.replacePlaceholders(
            cmd,
            this.processOption.audioTrack,
            this.config.audioBoost,
            'ts',
            isNormalizedByTsreadex,
        );
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
     * ライブ素材の映像特性から自動生成 cmd のデインターレースを解決する。
     * 解析できない場合は放送波を守るため従来どおり yadif 有りにする。
     * @param cmd: string
     * @return Promise<string>
     */
    private async resolveDeinterlace(cmd: string): Promise<string> {
        if (cmd.includes('%DEINTERLACE%') === false) return cmd;
        if (this.sourceAnalyzer === undefined || this.processOption === null) {
            return replaceDeinterlacePlaceholder(cmd);
        }

        try {
            const source = await this.sourceAnalyzer.analyzeLiveChannel(this.processOption.channelId);
            return replaceDeinterlacePlaceholder(cmd, toDeinterlaceInput(source));
        } catch (err) {
            this.log.stream.warn('live source analysis failed; keep deinterlace enabled');
            this.log.stream.debug(err);
            return replaceDeinterlacePlaceholder(cmd);
        }
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
        const poption = await this.createProcessOption(streamId);
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

                // 放送波の EIT[p/f] を読み、放送中番組の判定を Mirakurun の EPG より優先させる。
                // data リスナではなく Transform で挟む (data リスナは flowing モードへ切り替えて
                // pipe が繋がる前のデータを落とすため)
                this.eitPresentCollectTransform = this.createEitPresentCollectTransform();
                this.bitCollectTransform.pipe(this.eitPresentCollectTransform);
                const tsSource = this.eitPresentCollectTransform;

                // ARIB 字幕を ID3 timed metadata へ変換する (arib-subtitle-timedmetadater)。
                // HLS だけでなく mpegts 配信 (m2ts / m2tsll) でも必要:
                // DPlayer は mpegts.js の TIMED_ID3_METADATA_ARRIVED からしか aribb24 へ字幕を渡さないため、
                // ARIB 字幕 ES をそのまま流しても字幕は表示されない
                if (this.useOutputSideId3() === true) {
                    // ID3 (PID 0x1FFE) は入力側へ map せず、エンコード後 (streamProcess.stdout) に
                    // 挿入し直す (下の stdout 側の処理を参照)
                    this.log.stream.info('use arib-subtitle-timedmetadater (output side)');
                    tsSource.pipe(this.streamProcess.stdin);
                } else {
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
                }

                // m2tsll (および tsreadex 経由の m2ts) は、エンコード後の TS (ARIB 字幕 ES を
                // `-c:s copy` 済み) へ ID3 timed metadata を挿入し直す。getStream() はこの Transform を返す
                if (this.useOutputSideId3() === true && this.streamProcess.stdout !== null) {
                    this.id3OutputTransform = new ID3MetadataTransform();
                    this.streamProcess.stdout.pipe(this.id3OutputTransform);
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
            // 無変換配信 (エンコードプロセス無し) でも放送波の EIT[p/f] は読む。
            // 配信そのものは this.stream をそのまま返すため、解析用に枝を 1 本生やして捨てる
            // (同じ Readable へ複数 pipe しても各 destination へ同じデータが流れる)
            this.eitPresentCollectTransform = this.createEitPresentCollectTransform();
            this.stream.pipe(this.eitPresentCollectTransform);
            this.eitPresentCollectTransform.resume();

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
     * Fmp4Packager のロール (video/audio0/audio1) を HLSMemoryStoreModel のロール (v/a0/a1) へ変換する
     */
    private toHLSRole(role: Fmp4PackagerTrackRole): HLSMemoryTrackRole {
        return role === 'video' ? 'v' : role === 'audio0' ? 'a0' : 'a1';
    }

    /**
     * in-memory HLS のパッケージングを開始する
     * エンコードプロセスが標準出力へ書き出す fragmented MP4 を Fmp4Packager で
     * init / パート / セグメントに分解し、HLSMemoryStoreModel へ蓄積する (ディスク書き込みなし)
     *
     * fMP4 のフラグメント境界 (= GOP 境界) が 1 パートになる。
     * LIVE_HLS_PARTS_PER_SEGMENT 個のパートで 1 セグメントを構成し、
     * セグメント確定を待たずにパート (#EXT-X-PART) を配信することで遅延を詰める
     * @param streamId: apid.StreamId
     */
    private startMemoryHLSPackaging(streamId: apid.StreamId): void {
        if (this.streamProcess === null || this.streamProcess.stdout === null) {
            throw new Error('StreamProcessStdoutIsNull');
        }

        this.log.stream.info(`start in-memory HLS packaging: ${streamId}`);
        this.memoryStreamId = streamId;
        // 単一トラック (従来) モードのエントリは即座に作る (multiTrack 判定は moov 到着後なので、
        // 音声トラックが 2 本以上の場合はこのエントリは未使用のまま stop() で破棄される)
        this.hlsMemoryStore.create(streamId, 'live');

        const packager = new Fmp4Packager(
            { partsPerSegment: LiveStreamBaseModel.LIVE_HLS_PARTS_PER_SEGMENT },
            this.log,
        );
        this.fmp4Packager = packager;

        // 単一トラック (従来) モード。音声トラックが 1 本のときはこちらを使う
        packager.on('init', data => {
            this.hlsMemoryStore.setInit(streamId, data);
        });
        packager.on('part', part => {
            this.hlsMemoryStore.addPart(streamId, part.data, part.duration, part.isIndependent);
        });
        packager.on('segment', segment => {
            this.hlsMemoryStore.addSegment(streamId, segment.data, segment.duration);
            if (this.isEnable() === false && this.hlsMemoryStore.isReady(streamId) === true) {
                this.markEnable(streamId);
            }
        });

        // 複数音声トラック分解モード。音声トラックが 2 本以上のときはロールごとに別エントリへ振り分ける
        // (URL 体系・マスタープレイリストは doc/streaming-refresh.md を参照)
        packager.on('multiTrack', roles => {
            this.multiTrackRoles = roles;
            for (const role of roles) {
                this.hlsMemoryStore.create(streamId, 'live', this.toHLSRole(role));
            }
        });
        packager.on('trackInit', (role, data) => {
            this.hlsMemoryStore.setInit(streamId, data, this.toHLSRole(role));
        });
        packager.on('trackPart', (role, part) => {
            this.hlsMemoryStore.addPart(streamId, part.data, part.duration, part.isIndependent, this.toHLSRole(role));
        });
        packager.on('trackSegment', (role, segment) => {
            const hlsRole = this.toHLSRole(role);
            this.hlsMemoryStore.addSegment(streamId, segment.data, segment.duration, hlsRole);
            if (this.isEnable() === false && this.hlsMemoryStore.isReady(streamId, 'v') === true) {
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

        if (this.liveStreamSourceManageModel !== undefined) {
            this.mirakurunStreamLease = await this.liveStreamSourceManageModel.acquire(
                this.processOption.channelId,
                config.streamingPriority,
            );
            this.stream = this.mirakurunStreamLease.stream;

            return;
        }

        // 共有 source manager が無い旧式の直接組み立てでは従来経路を維持する。
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
        }
        if (this.mirakurunStreamLease !== null) {
            this.mirakurunStreamLease.release();
            this.mirakurunStreamLease = null;
        } else if (this.stream !== null) {
            this.stream.destroy();
        }
        this.stream = null;

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

        if (this.id3OutputTransform !== null) {
            if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
                this.streamProcess.stdout.unpipe(this.id3OutputTransform);
            }
            this.id3OutputTransform.unpipe();
            this.id3OutputTransform.destroy();
            this.id3OutputTransform = null;
        }

        if (this.bitCollectTransform !== null) {
            this.bitCollectTransform.unpipe();
            this.bitCollectTransform.destroy();
            this.bitCollectTransform = null;
        }

        if (this.eitPresentCollectTransform !== null) {
            this.eitPresentCollectTransform.unpipe();
            this.eitPresentCollectTransform.destroy();
            this.eitPresentCollectTransform = null;
        }
        if (this.processOption !== null) {
            // 配信が終わったら EIT は古くなるので捨てる (放送中判定は DB 由来へ戻る)
            this.eitPresentStore.clear(this.processOption.channelId);
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
                    // 単一トラック (従来) 用に即座に作ったエントリ (multiTrack 判定に関わらず必ず存在する)
                    this.hlsMemoryStore.delete(this.memoryStreamId);
                    if (this.multiTrackRoles !== null) {
                        for (const role of this.multiTrackRoles) {
                            this.hlsMemoryStore.delete(this.memoryStreamId, this.toHLSRole(role));
                        }
                        this.multiTrackRoles = null;
                    }
                    this.memoryStreamId = null;
                }
            } else {
                await this.fileDeleter.deleteAllFiles();
            }
        }
    }

    /**
     * 配信中の TS から EIT[p/f] を読む Transform を生成する
     * 相乗りサービス (ワンセグ・サブチャンネル) を弾くため、視聴中のサービス id を渡す
     * @return EitPresentCollectTransform
     */
    private createEitPresentCollectTransform(): EitPresentCollectTransform {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        // 放送局 id は networkId * 100000 + serviceId で構成される
        const serviceId = this.processOption.channelId % 100000;

        return new EitPresentCollectTransform(this.eitPresentStore, this.processOption.channelId, serviceId, this.log);
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.id3OutputTransform !== null) {
            // m2tsll / tsreadex 経由の m2ts: ID3 を挿入し直した Transform を返す
            return this.id3OutputTransform;
        } else if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
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
