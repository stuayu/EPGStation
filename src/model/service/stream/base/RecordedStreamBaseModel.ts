import { ChildProcess, exec, spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import internal, { Readable } from 'stream';
import AribSubtitleTimedMetadataTransform from '../llhls/AribSubtitleTimedMetadataTransform';
import * as apid from '../../../../../api';
import * as fst from '../../../../lib/TailStream';
import ProcessUtil from '../../../../util/ProcessUtil';
import { calculateRecordedStreamStartByte } from '../../../../util/RecordedStreamByteOffset';
import { normalizeStreamPlayPosition } from '../../../../util/StreamPlayPosition';
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
import IFmp4Packager, { Fmp4PackagerTrackRole } from '../llhls/IFmp4Packager';
import OfflineFmp4RecordStream from '../llhls/OfflineFmp4RecordStream';
import AudioTrackUtil from '../util/AudioTrackUtil';
import ISourceAnalyzer from '../../../stream/capability/ISourceAnalyzer';
import { SourceCapabilities } from '../../../stream/capability/ISourceCapabilities';
import { replaceDeinterlacePlaceholder, toDeinterlaceInput } from '../../../../util/DeinterlaceUtil';
import { shouldThrottleRecordedStream } from '../../../../util/RecordedStreamPacing';
import {
    createRecordedSubtitleReaderArgs,
    shouldUseEncodedTsSubtitleReader,
} from '../../../../util/RecordedSubtitleUtil';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IHLSMemoryStoreModel, { HLSMemoryTrackRole } from '../util/IHLSMemoryStoreModel';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel';
import { RecordedStreamInfo } from './IStreamBaseModel';
import StreamBaseModel from './StreamBaseModel';

class DelayedEndTransform extends internal.Transform {
    private readonly waitForEnd: Promise<void>;

    public constructor(waitForEnd: Promise<void>) {
        super();
        this.waitForEnd = waitForEnd;
    }

    public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: internal.TransformCallback): void {
        callback(null, chunk);
    }

    public override _flush(callback: internal.TransformCallback): void {
        this.waitForEnd.then(() => callback(), callback);
    }
}

@injectable()
export default abstract class RecordedStreamBaseModel
    extends StreamBaseModel<RecordedStreamOption>
    implements IRecordedStreamBaseModel
{
    // in-memory 録画済み HLS の 1 セグメントを構成するパート数
    // 1 パート = fMP4 フラグメント = GOP (EncodePresets の RECORDED_HLS_GOP_FRAMES で 0.5 秒) なので、
    // 2 パートで 1 秒セグメントになる (#EXT-X-TARGETDURATION は 1 秒が下限)
    private static readonly RECORDED_HLS_PARTS_PER_SEGMENT = 2;

    /**
     * エンコードを再生位置より先行させてよいセグメント数 (1 セグメント = 約 1 秒)。
     *
     * 録画ファイルのエンコードは実時間より数倍速いため、放っておくと再生位置から際限なく先行する。
     * in-memory ストアはセグメントを一定数しか保持しない (HLSMemoryStoreModel の
     * RECORDED_RETAIN_SEGMENT_NUM) ので、先行しすぎると**再生位置のセグメントが破棄され、
     * プレイリストの先頭が再生位置を追い越す**。hls.js は録画済みプレイリストも live 扱いで読むため
     * (成長し続ける = #EXT-X-ENDLIST が無い)、再生位置がプレイリストの範囲外になると
     * `synchronizeToLiveEdge()` がライブエッジ = エンコード最新位置へ強制シークする。
     *
     * 保持数より十分小さくしてこの追い越しを防ぐ。先行分はそのまま
     * 「シークに即応できる範囲」でもあるので、短くしすぎない
     */
    // HLSMemoryStoreModel の録画保持上限 (180 秒) から、プレイリスト更新・再生位置の安全余白 30 秒を引く。
    // 先読みを短くしすぎると Safari のネイティブ HLS でバッファが枯れやすくなる。
    private static readonly MAX_AHEAD_SEGMENT_NUM = 150;

    // ブラウザがこの先行量まで消費したらエンコードを再開する。
    // 再生を止めずに、保持窓の余裕も残すため数十秒分に設定する。
    private static readonly RESUME_AHEAD_SEGMENT_NUM = 30;

    /**
     * 先行 1 セグメントあたりの停止時間 (ms)。
     *
     * 抑制は**完全停止ではなく比例制御**で行う。停止時間 =
     * (先行量 - MAX_AHEAD_SEGMENT_NUM) × この値 で決め、MAX_PACE_INTERVAL で頭打ちにする。
     *
     * 完全に止めると**プレイリストが一切更新されなくなる**。LL-HLS のプレイヤー
     * (iOS Safari のネイティブ HLS など) はブロッキングプレイリスト要求 (`_HLS_msn`) の応答が
     * 変化するのを待ってから次のセグメントを取得するため、更新が止まると新しいセグメントを
     * 取りに来ない → クライアントの取得位置 (lastServedSeq) が進まない → 先行量が減らず
     * エンコードも再開しない、というデッドロックになる (再生が止まったまま戻らない)。
     *
     * また、一定時間ごとの ON/OFF (停止 1 秒 → 再開) のような粗い制御も避ける。
     * 停止中もエンコーダはパイプバッファへ書き込み続け、再開時に一気に流れ込むため、
     * 配信が「バーストと空白の繰り返し」になり再生がとびとびになる。
     * 超過量が小さいうちは短い停止を細かく入れることで、供給を滑らかに保つ
     */
    private static readonly PACE_INTERVAL_PER_SEGMENT = 100;

    /**
     * 1 回あたりの停止時間の上限 (ms)。
     * プレイヤーが取得自体をやめている (一時停止・離脱) 場合はここまで遅くなるが、
     * それでもプレイリストは更新され続けるのでプレイヤーが詰まることはない
     */
    private static readonly MAX_PACE_INTERVAL = 5000;

    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private hlsMemoryStore: IHLSMemoryStoreModel;
    private sourceAnalyzer: ISourceAnalyzer | undefined;
    private recordedSource: SourceCapabilities | null = null;

    private fileStream: Readable | null = null;
    private id3MetadataTransoform: AribSubtitleTimedMetadataTransform | null = null;
    // TS 入力の m2tsll は入力側へ ID3 を map せず、出力 TS へ再挿入する
    private id3OutputTransform: AribSubtitleTimedMetadataTransform | null = null;
    private streamProcess: ChildProcess | null = null;
    private videoFilePath: string | null = null;
    private videoFileInfo: VideoFileInfo | null = null;
    private videoFileType: apid.VideoFileType = 'encoded';
    private isRecording: boolean = false;
    private fmp4Packager: IFmp4Packager | null = null;
    // in-memory HLS で ARIB 字幕 (ID3 timed metadata) を取り出すための Transform
    private aribId3Extractor: IAribId3Extractor | null = null;
    private memoryStreamId: apid.StreamId | null = null;
    // 複数音声トラック分解モードで実際に使われたロール (音声 1 本のみなら null のまま)
    private multiTrackRoles: Fmp4PackagerTrackRole[] | null = null;
    // エンコードが先行しすぎたため一時停止しているか
    private isEncodeThrottled: boolean = false;
    private throttleTimerId: ReturnType<typeof setTimeout> | null = null;
    private offlineOutput: OfflineFmp4RecordStream | null = null;
    private offlineKeepTimerId: ReturnType<typeof setInterval> | null = null;
    private encodedSubtitleProcess: ChildProcess | null = null;
    private encodedSubtitleTransform: AribSubtitleTimedMetadataTransform | null = null;
    private encodedSubtitleProcessDone: Promise<void> = Promise.resolve();
    private delayedFmp4Input: DelayedEndTransform | null = null;
    private aribId3ExtractorConnected = false;

    /**
     * TS 入力の m2tsll 配信で ARIB 字幕を出力側へ付け直すか判定する
     * @return boolean
     */
    private useOutputSideId3(): boolean {
        return this.videoFileType === 'ts' && this.processOption !== null && this.processOption.container === 'm2tsll';
    }

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
        @inject('ISourceAnalyzer') sourceAnalyzer?: ISourceAnalyzer,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.hlsMemoryStore = hlsMemoryStore;
        this.sourceAnalyzer = sourceAnalyzer;
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

    private isOfflineHLS(): boolean {
        return this.getStreamType() === 'RecordedHLS' && this.processOption?.offline === true;
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

        // API 経由でない呼び出しも含め、エンコーダへ渡す開始位置を整数秒に揃える。
        this.processOption.playPosition = normalizeStreamPlayPosition(this.processOption.playPosition);

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            throw new Error('OutOfRange');
        }

        // 負の再生位置は受け付けない。
        // api.yml の ss は minimum を持たないため負値がここまで届く。素通しすると
        // エンコーダへ負の -ss を渡し、createReadStream の start も負になる
        if (this.processOption.playPosition < 0) {
            this.log.stream.warn(
                `negative playPosition: ${this.processOption.playPosition}, clamped to 0 (videoFileId: ${this.processOption.videoFileId})`,
            );
            this.processOption.playPosition = 0;
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
        try {
            this.streamProcess = await this.processManager.create(poption);
        } catch (err: any) {
            this.log.stream.error('create encode process failed');
            await this.stop();
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        // process 終了時にイベントを発行する
        // in-memory モードはディスク上のファイルが増えないため startCheckStreamEnable が使えず、
        // プロセスの exit/error を直接監視する必要がある (ライブ HLS の in-memory モードと同様)
        if (this.getStreamType() !== 'RecordedHLS' || this.isMemoryHLS() === true) {
            this.streamProcess.on('exit', code => {
                this.onStreamProcessExit(code);
            });
            this.streamProcess.on('error', () => {
                this.emitExitStream();
            });
        }
        if (this.getStreamType() === 'RecordedHLS') {
            if (this.isMemoryHLS() === true) {
                if (this.isOfflineHLS() === true) {
                    await this.startOfflineFmp4Packaging();
                } else {
                    // エンコードプロセスの fMP4 出力をメモリ上で HLS セグメント化する
                    await this.startMemoryHLSPackaging(streamId);
                }
            } else {
                // stream 有効チェク開始
                this.startCheckStreamEnable(streamId);
            }
        }
        // stream 停止タイマーセット
        this.setStopTimer();
        if (this.isOfflineHLS() === true) {
            // オフライン保存中はブラウザから keep 要求が来ないため、自前で保持する
            this.offlineKeepTimerId = setInterval(() => this.setStopTimer(), 5000);
        }

        // ffmpeg debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        // パイプ処理
        if (this.streamProcess.stdin !== null && this.fileStream !== null) {
            // ts が入力かつ HLS 配信の場合は ARIB 字幕を ID3 timed metadata へ変換する
            // ローカルの字幕 ES → ID3 変換器を通す (エンコード済みファイルには ARIB 字幕が含まれない)
            if (
                this.videoFileType === 'ts' &&
                (this.getStreamType() === 'RecordedHLS' || this.processOption?.container === 'm2tsll')
            ) {
                this.log.stream.info('use ARIB subtitle to ID3 timed metadata transform');
                if (this.useOutputSideId3() === true) {
                    // ID3 (PID 0x1FFE) は入力側へ map せず、エンコード後の MPEG-TS へ挿入し直す。
                    this.fileStream.pipe(this.streamProcess.stdin);
                } else {
                    this.id3MetadataTransoform = new AribSubtitleTimedMetadataTransform();
                    this.fileStream.pipe(this.id3MetadataTransoform);
                }

                if (this.isMemoryHLS() === true) {
                    // in-memory (fMP4) モードでは mp4 出力に ID3 timed metadata を乗せられないため、
                    // エンコード前の TS から ID3 を抜き取り、セグメントの emsg box として再多重化する
                    this.aribId3Extractor = new AribId3Extractor(this.log);
                    // 録画 HLS は startMemoryHLSPackaging() が先に呼ばれるため、
                    // パッケージャ作成時の listener 登録だけでは extractor を取りこぼす。
                    this.connectAribId3Extractor();
                    this.log.stream.info('[RecordedHLS] AribId3Extractor と Fmp4Packager の id3 経路を接続しました');
                    this.id3MetadataTransoform?.pipe(this.aribId3Extractor);
                    this.aribId3Extractor.pipe(this.streamProcess.stdin);
                } else if (this.useOutputSideId3() === false) {
                    this.id3MetadataTransoform?.pipe(this.streamProcess.stdin);
                }
            } else {
                this.fileStream.pipe(this.streamProcess.stdin);
            }
        }

        if (this.useOutputSideId3() === true && this.streamProcess.stdout !== null) {
            this.id3OutputTransform = new AribSubtitleTimedMetadataTransform();
            this.streamProcess.stdout.pipe(this.id3OutputTransform);
        }

        // プロセスが即時終了していた場合
        if (ProcessUtil.isExited(this.streamProcess) === true) {
            this.streamProcess.removeAllListeners();
            this.emitExitStream();
        }
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
     * ストアは 'recorded' モードで作る。シークバーでの巻き戻しに応えるため、
     * ライブより多くのセグメントを保持しプレイリストへ載せる
     * @param streamId: apid.StreamId
     */
    private async startMemoryHLSPackaging(streamId: apid.StreamId): Promise<void> {
        if (this.streamProcess === null || this.streamProcess.stdout === null) {
            throw new Error('StreamProcessStdoutIsNull');
        }

        this.log.stream.info(`start in-memory recorded HLS packaging: ${streamId}`);
        this.memoryStreamId = streamId;
        this.startInitialHlsOutputWarningTimer(streamId, '録画');
        // 単一トラック (従来) モードのエントリは即座に作る (multiTrack 判定は moov 到着後なので、
        // 音声トラックが 2 本以上の場合はこのエントリは未使用のまま stop() で破棄される)
        this.hlsMemoryStore.create(streamId, 'recorded');

        const packager = new Fmp4Packager(
            { partsPerSegment: RecordedStreamBaseModel.RECORDED_HLS_PARTS_PER_SEGMENT, mode: 'recorded' },
            this.log,
        );
        this.fmp4Packager = packager;
        await this.startEncodedTsSubtitleReader();

        // 単一トラック (従来) モード
        packager.on('init', data => {
            this.hlsMemoryStore.setInit(streamId, data);
        });
        packager.on('part', part => {
            this.hlsMemoryStore.addPart(streamId, part.data, part.duration, part.isIndependent);
        });
        packager.on('segment', segment => {
            this.markInitialHlsOutput();
            this.hlsMemoryStore.addSegment(streamId, segment.data, segment.duration);
            if (this.isEnable() === false && this.hlsMemoryStore.isReady(streamId) === true) {
                this.markEnable(streamId);
            }
            this.throttleEncodeIfTooFarAhead(streamId);
        });

        // 複数音声トラック分解モード。ロールごとに別エントリへ振り分ける
        // (getAheadSegmentNum() / エンコード抑制は role: 'v' の値を基準にする)
        packager.on('multiTrack', roles => {
            this.multiTrackRoles = roles;
            for (const role of roles) {
                this.hlsMemoryStore.create(streamId, 'recorded', this.toHLSRole(role));
            }
        });
        packager.on('trackInit', (role, data) => {
            this.hlsMemoryStore.setInit(streamId, data, this.toHLSRole(role));
        });
        packager.on('trackPart', (role, part) => {
            this.hlsMemoryStore.addPart(streamId, part.data, part.duration, part.isIndependent, this.toHLSRole(role));
        });
        packager.on('trackSegment', (role, segment) => {
            this.markInitialHlsOutput();
            const hlsRole = this.toHLSRole(role);
            this.hlsMemoryStore.addSegment(streamId, segment.data, segment.duration, hlsRole);
            if (this.isEnable() === false && this.hlsMemoryStore.isReady(streamId, 'v') === true) {
                this.markEnable(streamId);
            }
            if (role === 'video') {
                this.throttleEncodeIfTooFarAhead(streamId);
            }
        });

        packager.on('halted', message => {
            this.log.stream.error(`in-memory recorded HLS packaging halted: ${streamId} ${message}`);
            this.emitExitStream();
        });

        // エンコード前の TS から抜き取った ID3 timed metadata (ARIB 字幕) をセグメントへ乗せる
        this.connectAribId3Extractor();

        const stdout = this.streamProcess.stdout;
        if (this.encodedSubtitleProcess === null) {
            stdout.pipe(packager);
        } else {
            stdout.pipe(this.createDelayedFmp4Input()).pipe(packager);
        }
    }

    /** オフライン保存用に fMP4 を保持窓なしでレコード化する */
    private async startOfflineFmp4Packaging(): Promise<void> {
        if (this.streamProcess === null || this.streamProcess.stdout === null)
            throw new Error('StreamProcessStdoutIsNull');
        const packager = new Fmp4Packager(
            { partsPerSegment: RecordedStreamBaseModel.RECORDED_HLS_PARTS_PER_SEGMENT * 6, mode: 'recorded' },
            this.log,
        );
        this.fmp4Packager = packager;
        await this.startEncodedTsSubtitleReader();
        this.connectAribId3Extractor();
        const stdout = this.streamProcess.stdout;
        if (this.encodedSubtitleProcess === null) {
            this.offlineOutput = new OfflineFmp4RecordStream(stdout, packager);
        } else {
            const delayedInput = this.createDelayedFmp4Input();
            stdout.pipe(delayedInput);
            this.offlineOutput = new OfflineFmp4RecordStream(delayedInput, packager);
        }
    }

    /** encoded 扱いの MPEG-TS から字幕だけを映像と同じ時刻位置で読み出す。 */
    private async startEncodedTsSubtitleReader(): Promise<void> {
        if (
            this.videoFilePath === null ||
            this.processOption === null ||
            shouldUseEncodedTsSubtitleReader(this.videoFileType, this.processOption.container, this.recordedSource) ===
                false
        ) {
            return;
        }

        const seekOffset = await this.getEncodedTsSeekOffset();
        const subtitleProcess = spawn(
            this.config.ffmpeg,
            createRecordedSubtitleReaderArgs(this.videoFilePath, this.processOption.playPosition + seekOffset),
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        this.encodedSubtitleProcess = subtitleProcess;
        this.encodedSubtitleProcessDone = new Promise(resolve => {
            let settled = false;
            const done = (): void => resolve();
            const settle = (event: string, code?: number | null): void => {
                if (settled === true) return;
                settled = true;
                this.log.stream.debug(`[encoded subtitle reader] ${event}: ${String(code ?? '')}`);
                done();
            };
            subtitleProcess.once('close', code => settle('close', code));
            subtitleProcess.once('exit', code => {
                // close は stdio の close 後に来るが、ffmpeg の pipe 状態によっては
                // exit だけ先に通知される。字幕 stdout は pipe 済みなので、次 tick で
                // 残りを読み切る機会を与えてから EOF 待ちを解放する。
                setImmediate(() => settle('exit', code));
            });
            subtitleProcess.once('error', () => settle('error'));
        });
        this.encodedSubtitleTransform = new AribSubtitleTimedMetadataTransform();
        this.aribId3Extractor = new AribId3Extractor(this.log);
        this.encodedSubtitleTransform.pipe(this.aribId3Extractor);
        subtitleProcess.stdout?.pipe(this.encodedSubtitleTransform);
        // encoded TS の字幕 reader では id3 イベントだけ使い、Transform の
        // pass-through 出力は使わない。未消費のままだと highWaterMark 到達後に
        // 字幕 ffmpeg が backpressure で止まり、オフライン出力の EOF も止まる。
        this.aribId3Extractor.resume();
        subtitleProcess.stderr?.on('data', data => this.log.stream.debug(`[encoded subtitle reader] ${String(data)}`));
        subtitleProcess.on('error', err => this.log.stream.warn(`encoded subtitle reader failed: ${String(err)}`));
        this.connectAribId3Extractor();
    }

    /**
     * 主 ffmpeg の -ss が選ぶ実際の映像開始位置を短い probe で求める。
     * VBR の byte seek や字幕 ES の先頭を基準にせず、主映像と同じキーフレーム境界へ字幕を合わせる。
     * @return number 要求位置から主映像開始までの秒差。失敗時は 0
     */
    private async getEncodedTsSeekOffset(): Promise<number> {
        if (this.videoFilePath === null || this.processOption === null || this.recordedSource?.transport !== 'mpegts') {
            return 0;
        }

        const requested = Math.max(0, this.processOption.playPosition);
        const base = this.videoFileInfo?.startTime ?? 0;
        const encoder = spawn(
            this.config.ffmpeg,
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-copyts',
                '-ss',
                String(requested),
                '-i',
                this.videoFilePath,
                '-map',
                '0:v:0',
                '-c:v',
                'copy',
                '-to',
                String(base + requested + 5),
                '-f',
                'mpegts',
                'pipe:1',
            ],
            { stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const probe = spawn(
            this.config.ffprobe,
            [
                '-v',
                'error',
                '-f',
                'mpegts',
                '-select_streams',
                'v:0',
                '-show_packets',
                '-show_entries',
                'packet=pts_time',
                '-of',
                'json',
                'pipe:0',
            ],
            { stdio: ['pipe', 'pipe', 'ignore'] },
        );
        let output = '';
        probe.stdout?.on('data', data => {
            output += String(data);
        });
        if (probe.stdin !== null) {
            ProcessUtil.attachStdinErrorHandler(probe.stdin, error => {
                this.log.stream.debug('subtitle probe stdin error', error);
            });
        }
        encoder.stdout?.pipe(probe.stdin as NodeJS.WritableStream);

        await Promise.all([
            new Promise<void>(resolve => {
                encoder.once('close', () => resolve());
                encoder.once('error', () => resolve());
            }),
            new Promise<void>(resolve => {
                probe.once('close', () => resolve());
                probe.once('error', () => resolve());
            }),
        ]);

        try {
            const first = Number(JSON.parse(output).packets?.[0]?.pts_time);
            const offset = first - base - requested;
            if (Number.isFinite(offset) && offset >= 0 && offset < 30) return offset;
        } catch (_error) {
            // probe failure is non-fatal; old files must remain playable without subtitle timing correction.
        }
        this.log.stream.debug('encoded TS subtitle seek probe failed; using requested position');

        return 0;
    }

    private connectAribId3Extractor(): void {
        if (this.aribId3Extractor === null || this.fmp4Packager === null || this.aribId3ExtractorConnected === true) {
            return;
        }
        this.aribId3Extractor.on('id3', metadata => {
            this.fmp4Packager?.pushId3(metadata, this.encodedSubtitleProcess !== null);
        });
        this.aribId3ExtractorConnected = true;
    }

    private createDelayedFmp4Input(): DelayedEndTransform {
        this.delayedFmp4Input = new DelayedEndTransform(this.encodedSubtitleProcessDone);

        return this.delayedFmp4Input;
    }

    /**
     * エンコードプロセス終了時の処理
     *
     * 録画済み in-memory HLS のエンコードは実時間より速く終わるため、再生が終わるより先に
     * 必ずエンコーダが終了する。ここで従来どおり emitExitStream() (= ストリーム停止) を
     * 呼んでしまうと、stop() の hlsMemoryStore.delete() でまだプレイヤーが取得していない
     * 末尾のセグメントまで失われる (実測: 9.8 分の録画で 363 秒地点まで再生できたのに
     * エンコーダ終了と同時にストアごと削除され、そこで再生が止まったまま戻らなくなった)。
     *
     * そのため正常終了 (exit code 0) の場合はストリームを止めず、ストアへ終端
     * (#EXT-X-ENDLIST) を記録するだけに留める。実際の停止はクライアント切断や
     * keep タイマー切れ (StreamBaseModel.setStopTimer()) による通常の stop() に任せる。
     * 異常終了 (0 以外の exit code) は録り直しようがないため従来どおり即座に停止する
     * @param code: number | null 子プロセスの終了コード
     */
    private onStreamProcessExit(code: number | null): void {
        // 通常の録画ストリームは stdout の EOF がレスポンスへ伝わってから停止する。
        // ここで即時に emitExitStream() すると、エンコーダが実時間より速く完了した時点で
        // まだブラウザが再生中の配信を「停止」と記録してしまう。正常終了は EOF として扱い、
        // HTTP レスポンス完了後の route cleanup に任せる。
        if (this.getStreamType() === 'RecordedStream' && code === 0) {
            this.log.stream.info('recorded stream encode process finished normally');

            return;
        }

        if (
            this.getStreamType() === 'RecordedHLS' &&
            this.isMemoryHLS() === true &&
            code === 0 &&
            this.memoryStreamId !== null
        ) {
            this.log.stream.info(`in-memory recorded HLS encode process finished normally: ${this.memoryStreamId}`);
            if (this.multiTrackRoles !== null) {
                for (const role of this.multiTrackRoles) {
                    this.hlsMemoryStore.markEnded(this.memoryStreamId, this.toHLSRole(role));
                }
            } else {
                this.hlsMemoryStore.markEnded(this.memoryStreamId);
            }

            return;
        }

        if (this.isOfflineHLS() === true && code === 0) {
            this.log.stream.info('offline recorded HLS encode process finished normally');
            return;
        }

        this.emitExitStream();
    }

    /**
     * エンコードが再生位置より先行しすぎていたらペースを落とす。
     * 標準出力の読み出しを止めるとパイプが詰まり、エンコーダ自身が書き込みでブロックする
     *
     * 先行量が RESUME_AHEAD_SEGMENT_NUM まで減れば早期に再開する。減らなくても、
     * このタイミングで計算した比例停止時間 (pauseTime、上限 MAX_PACE_INTERVAL) が
     * 経過すれば必ず再開する。完全に止めるとプレイリストの更新も止まり、
     * LL-HLS のプレイヤーが次のセグメントを取りに来なくなってデッドロックするため
     * @param streamId: apid.StreamId
     */
    private throttleEncodeIfTooFarAhead(streamId: apid.StreamId): void {
        if (shouldThrottleRecordedStream(this.isOfflineHLS()) === false) return;
        if (this.isEncodeThrottled === true) {
            return;
        }

        // 複数音声トラック分解モードでは role: 'v' (映像) の先行量を基準にする
        // (全ロールが同じ moof 周期で確定するため、映像 1 系統で足りる)
        const aheadRole = this.multiTrackRoles !== null ? 'v' : undefined;
        const aheadNum = this.hlsMemoryStore.getAheadSegmentNum(streamId, aheadRole);
        const excessNum = aheadNum - RecordedStreamBaseModel.MAX_AHEAD_SEGMENT_NUM;
        if (excessNum <= 0) {
            return;
        }

        const stdout = this.streamProcess?.stdout ?? null;
        if (stdout === null) {
            return;
        }

        // 超過が小さいうちは短く止めて供給を滑らかに保ち、
        // 大きくなるほど長く止めて先行を抑える
        const pauseTime = Math.min(
            excessNum * RecordedStreamBaseModel.PACE_INTERVAL_PER_SEGMENT,
            RecordedStreamBaseModel.MAX_PACE_INTERVAL,
        );

        this.log.stream.debug(`pause encode ${pauseTime}ms (ahead ${aheadNum} segments): ${streamId}`);
        this.isEncodeThrottled = true;
        stdout.pause();

        const throttleStartedAt = Date.now();
        const resumeThrottle = (): void => {
            this.clearThrottleTimer();
            if (this.isEncodeThrottled === false) {
                return;
            }

            const currentAheadNum = this.hlsMemoryStore.getAheadSegmentNum(streamId, aheadRole);
            const elapsedTime = Date.now() - throttleStartedAt;
            // ループの上限は MAX_PACE_INTERVAL (定数) ではなく、この超過量に対して計算した
            // pauseTime を使う。MAX_PACE_INTERVAL 固定だと、pauseTime が小さく計算された
            // (超過がわずかな) 場合でも常に最大 5 秒まで引き延ばされてしまい、
            // ログの "pause encode <pauseTime>ms" と実際の停止時間が食い違っていた。
            // (先行量は視聴の実時間経過でしか減らないため、100ms 程度の短い pauseTime では
            // RESUME_AHEAD_SEGMENT_NUM まで下がりきらず、毎回ループが延長され続けていた)
            if (currentAheadNum > RecordedStreamBaseModel.RESUME_AHEAD_SEGMENT_NUM && elapsedTime < pauseTime) {
                this.throttleTimerId = setTimeout(
                    resumeThrottle,
                    Math.min(RecordedStreamBaseModel.PACE_INTERVAL_PER_SEGMENT, pauseTime - elapsedTime),
                );
                return;
            }

            this.log.stream.debug(
                `resume encode (ahead ${currentAheadNum} segments, elapsed ${elapsedTime}ms): ${streamId}`,
            );
            this.isEncodeThrottled = false;
            stdout.resume();
        };
        this.throttleTimerId = setTimeout(resumeThrottle, pauseTime);
    }

    /**
     * エンコード再開待ちのタイマーを止める
     */
    private clearThrottleTimer(): void {
        if (this.throttleTimerId !== null) {
            clearTimeout(this.throttleTimerId);
            this.throttleTimerId = null;
        }
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
        if (this.sourceAnalyzer !== undefined) {
            try {
                this.recordedSource = await this.sourceAnalyzer.analyzeRecordedFile(video.id);
            } catch (err) {
                this.log.stream.debug(`recorded source analysis for subtitles failed: ${String(err)}`);
            }
        }
    }

    /**
     * 指定されたファイルパスのビデオ情報を取得する
     * @param filePath: string
     * @return Promise<VideoFileInfo>
     */
    private getVideoInfo(filePath: string): Promise<VideoFileInfo> {
        return new Promise<VideoFileInfo>((resolve, reject) => {
            exec(`${this.config.ffprobe} -v 0 -show_format -show_streams -of json "${filePath}"`, (err, std) => {
                if (err) {
                    reject(err);

                    return;
                }
                const result = <any>JSON.parse(std);

                const startTime = parseFloat(
                    result.streams?.find((stream: any) => stream.codec_type === 'video')?.start_time ?? '0',
                );
                resolve({
                    duration: parseFloat(result.format.duration),
                    size: parseInt(result.format.size, 10),
                    bitRate: parseFloat(result.format.bit_rate),
                    startTime: Number.isFinite(startTime) ? startTime : 0,
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

        // tsreadex を通す cmd はデュアルモノラルが 2 本の音声 ES へ分離済みなので、
        // 副音声の選び方が変わる (置換前の cmd で判定する)
        const isNormalizedByTsreadex = this.processOption.cmd.includes('%TSREADEX%');
        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%TSREADEX%/g, typeof this.config.tsreadex === 'undefined' ? 'tsreadex' : this.config.tsreadex)
            .replace(/%SS%/g, this.videoFileType === 'ts' ? '' : this.processOption.playPosition.toString(10));

        cmd = await this.resolveDeinterlace(cmd);

        // 録画ファイルの実音声 ES 数を有限 probe する。probe に失敗しても配信自体は
        // 従来のデュアルモノラル判定で継続する。
        let audioStreamCount: number | undefined;
        try {
            const audioTracks = await this.videoUtil.getAudioTracks(this.videoFilePath, {
                isRecording: this.isRecording,
            });
            audioStreamCount = AudioTrackUtil.getAudioStreamCount(audioTracks);
        } catch (err: unknown) {
            this.log.stream.warn(
                `録画音声 ES の probe に失敗したため従来の音声選択へフォールバックします: ${String(err)}`,
            );
        }

        // 音声トラック指定・フィルタ (%DUALMONOMODE% / %AUDIOMAP% / %AUDIOFILTER%) を展開する
        cmd = AudioTrackUtil.replacePlaceholders(
            cmd,
            this.processOption.audioTrack,
            this.config.audioBoost,
            this.videoFileType,
            isNormalizedByTsreadex,
            audioStreamCount,
            this.processOption.container === 'm2tsll' || this.isMemoryHLS(),
        );

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
            // HLS packager / HTTP response が stdout を読む。EncodeProcessManageModel の既定 drain は
            // startEncodedTsSubtitleReader() の probe 待ち中に ftyp/moov を捨てる。
            drainStdout: false,
        };

        return option;
    }

    /**
     * 録画素材の映像特性から自動生成 cmd のデインターレースを解決する。
     * 解析できない場合は放送 TS を守るため yadif 有りにする。
     * @param cmd: string
     * @return Promise<string>
     */
    private async resolveDeinterlace(cmd: string): Promise<string> {
        if (cmd.includes('%DEINTERLACE%') === false) return cmd;
        if (this.sourceAnalyzer === undefined || this.processOption === null) {
            return replaceDeinterlacePlaceholder(cmd);
        }

        try {
            const source = await this.sourceAnalyzer.analyzeRecordedFile(this.processOption.videoFileId);
            return replaceDeinterlacePlaceholder(cmd, toDeinterlaceInput(source));
        } catch (err) {
            this.log.stream.warn('recorded source analysis failed; keep deinterlace enabled');
            this.log.stream.debug(err);
            return replaceDeinterlacePlaceholder(cmd);
        }
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

        // reader は要求ごとに作り直す。TailStream の offset は内部状態なので、前回の reader を使い回さない。
        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
            this.fileStream = null;
        }

        if (this.delayedFmp4Input !== null) {
            this.delayedFmp4Input.destroy();
            this.delayedFmp4Input = null;
        }

        if (this.encodedSubtitleTransform !== null) {
            this.encodedSubtitleTransform.unpipe();
            this.encodedSubtitleTransform.destroy();
            this.encodedSubtitleTransform = null;
        }

        const estimatedStart = Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition);
        const start = calculateRecordedStreamStartByte(
            this.videoFileInfo.bitRate,
            this.processOption.playPosition,
            this.videoFileInfo.size,
        );
        this.log.stream.info(
            `create recorded file stream: ${this.videoFilePath} ` +
                `(videoFileId: ${this.processOption.videoFileId}, playPosition: ${this.processOption.playPosition}s, ` +
                `estimatedOffset: ${estimatedStart}, readStart: ${start}, fileSize: ${this.videoFileInfo.size})`,
        );
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
        if (this.offlineKeepTimerId !== null) {
            clearInterval(this.offlineKeepTimerId);
            this.offlineKeepTimerId = null;
        }
        await super.stop();

        this.clearThrottleTimer();
        this.isEncodeThrottled = false;

        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
            this.fileStream = null;
        }

        if (this.aribId3Extractor !== null) {
            this.aribId3Extractor.unpipe();
            this.aribId3Extractor.removeAllListeners();
            this.aribId3Extractor.destroy();
            this.aribId3Extractor = null;
        }
        this.aribId3ExtractorConnected = false;

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

        if (this.fmp4Packager !== null) {
            if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
                this.streamProcess.stdout.unpipe();
            }
            this.fmp4Packager.destroy();
            this.fmp4Packager = null;
        }

        if (this.offlineOutput !== null) {
            this.offlineOutput.destroy();
            this.offlineOutput = null;
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess);
        }
        if (this.encodedSubtitleProcess !== null) {
            await ProcessUtil.kill(this.encodedSubtitleProcess);
            this.encodedSubtitleProcess = null;
        }

        if (this.getStreamType() === 'RecordedHLS') {
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
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.offlineOutput !== null) return this.offlineOutput;
        if (this.id3OutputTransform !== null) {
            return this.id3OutputTransform;
        } else if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
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
