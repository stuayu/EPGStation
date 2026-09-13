import * as stream from 'stream';
import ILogger from '../../../ILogger';
import { AribId3Metadata } from './IAribId3Extractor';
import IFmp4Packager, {
    Fmp4PackagerOption,
    Fmp4PackagerPart,
    Fmp4PackagerSegment,
    Fmp4PackagerMode,
    Fmp4PackagerTrackRole,
} from './IFmp4Packager';

/**
 * ffmpeg などが出力する fragmented mp4 (CMAF) の生バイトストリームを受け取り、
 * ISO-BMFF のトップレベル box (ftyp / moov / moof / mdat) の境界だけを解析して
 * init セグメント・パート (moof+mdat)・セグメント (複数パートの集合) を組み立てる Writable。
 *
 * 深い box 階層の解析は行わず、init セグメントの継続時間算出に必要な
 * moov→trak→mdia→mdhd (timescale) と moof→traf→tfhd/tfdt (trackId, baseMediaDecodeTime)
 * のみを辿る。
 *
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
class Fmp4Packager extends stream.Writable implements IFmp4Packager {
    private log: ILogger | null;
    private partsPerSegment: number;
    private mode: Fmp4PackagerMode;

    // 受信したが未処理のバイト列
    private buffer: Buffer = Buffer.alloc(0);
    // 破損入力を検知して以後の解析を停止したかどうか
    private halted = false;
    // size == 0 (末尾まで) の box を検知した場合、その box 情報を保持する
    private pendingUnknownSizeBox: { type: string; headerSize: number } | null = null;

    // ftyp 取得済みかどうかの簡易フェーズ管理
    private phase: 'waiting-ftyp' | 'waiting-moov' | 'streaming' = 'waiting-ftyp';
    private ftypBuf: Buffer | null = null;
    // init フェーズ中に現れた未知 box (通常は現れない想定だが保険として蓄積する)
    private leadingExtra: Buffer = Buffer.alloc(0);
    // streaming フェーズ中、直近の part と次の part の間に現れた未知 box (mfra など)
    private streamingExtra: Buffer = Buffer.alloc(0);

    // moov から得た trackId -> timescale
    private trackTimescale: Map<number, number> = new Map();
    // moof(traf) を読み終えて mdat 待ちの状態
    private pendingMoof: {
        buf: Buffer;
        trackId: number | null;
        tfdt: number | null;
        timescale: number | null;
        extraPrefix: Buffer;
    } | null = null;

    // トラックごとの直近 part スロット (継続時間確定用)
    private lastSlotByTrack: Map<number, Fmp4Packager.PartSlot> = new Map();
    // トラックごとに直近確定した継続時間 (終端パートのフォールバックに使う)
    private lastDurationByTrack: Map<number, number> = new Map();
    // 到着順を保った、まだ emit していない part スロットの待ち行列
    private slotQueue: Fmp4Packager.PartSlot[] = [];

    // 現在組み立て中のセグメントを構成する part
    private currentSegmentParts: Fmp4PackagerPart[] = [];

    // 次のセグメントへ乗せる ID3 timed metadata (ARIB 字幕)
    private pendingId3: AribId3Metadata[] = [];

    // emsg box の id (セグメントをまたいでユニークな値を使う)
    private emsgId = 0;

    // 診断用の出力統計
    private generatedPartCount = 0;
    private attachedEmsgBytes = 0;

    // 統計 (検証用): 入力バイト数
    private totalInputBytes = 0;

    // 音声トラックが 2 本以上ある入力を検出したかどうか (moov 解析後に確定する)
    // true の場合、init / part / segment は 'trackInit' / 'trackPart' / 'trackSegment' でのみ emit され、
    // 従来の 'init' / 'part' / 'segment' は emit されない (trak が 1 音声のみの入力は従来どおり)
    private multiTrack = false;
    // moov から求めた trackId -> 役割 (video / audio0 / audio1)。2 本目以降の余剰音声トラックは含まない
    private trackRoleById: Map<number, Fmp4PackagerTrackRole> = new Map();
    // ロールごとの分解状態
    private mtTrackStates: Map<Fmp4PackagerTrackRole, Fmp4Packager.MtTrackState> = new Map();
    // moof 解析中に集めた、トラックごとの traf 情報 (mdat 到着で確定させる)
    private mtPendingMoof: {
        moofBoxBuf: Buffer;
        mfhdBox: Buffer | null;
        trafs: Map<number, Fmp4Packager.MtTrafInfo>;
    } | null = null;
    // moof と mdat の間に現れた未知 box (通常は現れない)。dataOffset の相対位置を保つため
    // moofBoxBuf の直後・mdatBoxBuf の直前として fragBuf へ連結する
    private mtExtraBeforeMdat: Buffer = Buffer.alloc(0);

    private logGeneratedPart(role?: Fmp4PackagerTrackRole): void {
        this.generatedPartCount += 1;
        if (this.generatedPartCount === 1 || this.generatedPartCount % 10 === 0) {
            this.log?.stream.info(
                `[Fmp4Packager] ${this.mode} part を生成しました: count=${this.generatedPartCount}, ` +
                    `role=${role ?? 'single'}, pendingMetadata=${this.pendingId3.length}, ` +
                    `emsgBytes=${this.attachedEmsgBytes}`,
            );
        }
    }

    constructor(option: Fmp4PackagerOption = {}, logger: ILogger | null = null) {
        super();

        this.log = logger;
        this.partsPerSegment =
            typeof option.partsPerSegment === 'number' && option.partsPerSegment > 0
                ? option.partsPerSegment
                : Fmp4Packager.DEFAULT_PARTS_PER_SEGMENT;
        this.mode = option.mode ?? 'live';
    }

    /**
     * これまでに書き込まれた総バイト数を返す (検証用)
     * @return number
     */
    public getTotalInputBytes(): number {
        return this.totalInputBytes;
    }

    /**
     * エンコード前の TS から抜き取った ID3 timed metadata (ARIB 字幕) を登録する
     * 登録された metadata は次に出力するセグメント先頭の emsg box として多重化される
     * @param metadata: AribId3Metadata
     */
    public pushId3(metadata: AribId3Metadata): void {
        if (this.halted === true) {
            return;
        }

        this.pendingId3.push(metadata);

        if (this.pendingId3.length === 1 || this.pendingId3.length % 10 === 0) {
            this.log?.stream.debug(
                `[Fmp4Packager] ID3 metadata を保留しました: mode=${this.mode}, pending=${this.pendingId3.length}`,
            );
        }

        // セグメントが出力されない状況でメモリを食い潰さないようにする
        while (this.pendingId3.length > Fmp4Packager.MAX_PENDING_ID3) {
            this.pendingId3.shift();
        }
    }

    /**
     * 保留中の ID3 timed metadata を emsg box 列として組み立てる
     *
     * LL-HLS では 1 パートが単独で配信される (プレイヤーはセグメント全体を待たずに
     * パートを取得して再生する) ため、emsg はセグメント先頭ではなくパート先頭に置く。
     * セグメントは各パートのバイト列の連結なので、パートに載せた emsg はそのまま
     * セグメント側にも含まれる
     * @param baseMediaDecodeTime: number | null パートの tfdt
     * @param timescale: number | null パートのトラックの timescale
     * @return Buffer 保留がない場合は空の Buffer
     */
    private buildPendingEmsgBoxes(baseMediaDecodeTime: number | null, timescale: number | null): Buffer {
        if (this.pendingId3.length === 0) {
            return Buffer.alloc(0);
        }

        const pending = this.pendingId3;
        this.pendingId3 = [];

        // emsg の時刻はメディアタイムライン上の絶対値 (version 1) で表す必要があるため、
        // セグメント先頭パートの tfdt を基準にする。tfdt が取れない場合は 0 起点とする
        const scale = timescale !== null && timescale > 0 ? timescale : Fmp4Packager.PTS_TIMESCALE;
        const segmentBase = baseMediaDecodeTime !== null && baseMediaDecodeTime >= 0 ? baseMediaDecodeTime : 0;

        // ID3 の PTS (90kHz) はエンコード前の TS のものでメディアタイムラインと基準が異なるため、
        // パート先頭 (= 最初の metadata) からの相対時刻に変換して載せ替える
        const base = pending[0].pts;
        const boxes: Buffer[] = [];
        for (const metadata of pending) {
            const diff = metadata.pts - base;
            const delta = diff > 0 && diff < Fmp4Packager.MAX_EMSG_DELTA ? diff : 0;
            const presentationTime = segmentBase + Math.round((delta / Fmp4Packager.PTS_TIMESCALE) * scale);
            boxes.push(this.buildEmsgBox(scale, presentationTime, metadata.payload));
        }

        const emsg = Buffer.concat(boxes);
        this.attachedEmsgBytes += emsg.length;
        this.log?.stream.info(
            `[Fmp4Packager] emsg を付与しました: mode=${this.mode}, metadata=${pending.length}, ` +
                `bytes=${emsg.length}, totalBytes=${this.attachedEmsgBytes}, pending=${this.pendingId3.length}`,
        );

        return emsg;
    }

    /**
     * emsg box (version 1) を組み立てる
     *
     * hls.js の parseEmsg は version 0 のとき version + flags の 4 byte を読み飛ばさずに
     * scheme_id_uri の読み取りを始めるため、先頭が必ず 0x00 になる version 0 の emsg は
     * scheme_id_uri が空と解釈され ID3 として認識されない。version 1 のみ正しく解析されるため、
     * 相対時刻 (version 0) ではなくメディアタイムライン上の絶対時刻 (version 1) で出力する。
     *
     * @param timescale: number presentationTime の時間単位
     * @param presentationTime: number メディアタイムライン上の絶対時刻 (timescale 単位)
     * @param messageData: Buffer ID3 タグ本体
     * @return Buffer
     */
    private buildEmsgBox(timescale: number, presentationTime: number, messageData: Buffer): Buffer {
        const schemeIdUri = Buffer.from(`${Fmp4Packager.EMSG_SCHEME_ID_URI}\0`, 'utf8');
        // value は空文字列 (null 終端のみ)
        const value = Buffer.from('\0', 'utf8');

        // version(1) + flags(3)
        const versionAndFlags = Buffer.alloc(4);
        versionAndFlags.writeUInt8(1, 0);

        // version 1 は timescale / presentation_time(64bit) / event_duration / id の順で、
        // scheme_id_uri と value はその後ろに置く
        const fields = Buffer.alloc(20);
        fields.writeUInt32BE(timescale, 0);
        fields.writeBigUInt64BE(BigInt(Math.max(0, Math.round(presentationTime))), 4);
        // event_duration 不明
        fields.writeUInt32BE(0xffffffff, 12);
        this.emsgId = (this.emsgId + 1) % 0xffffffff;
        fields.writeUInt32BE(this.emsgId, 16);

        const body = Buffer.concat([versionAndFlags, fields, schemeIdUri, value, messageData]);
        const header = Buffer.alloc(8);
        header.writeUInt32BE(header.length + body.length, 0);
        header.write('emsg', 4, 'ascii');

        return Buffer.concat([header, body]);
    }

    /**
     * stream.Writable._write の実装
     * 受け取ったチャンクを内部バッファに追記し、可能な限り box を切り出して処理する
     */
    public override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
        this.totalInputBytes += chunk.length;

        if (this.halted === true) {
            // 破損検知済みの場合は以後のデータを黙って読み捨てる (upstream を詰まらせない)
            callback();

            return;
        }

        try {
            this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
            this.processBuffer();
        } catch (err: any) {
            this.haltWithError(`_write 中に例外が発生したため解析を停止します: ${err?.message}`);
        }

        callback();
    }

    /**
     * stream.Writable._final の実装
     * 終端に達した時点で残っているデータ・保留中の part を可能な範囲で確定させて出力する
     */
    public override _final(callback: (error?: Error | null) => void): void {
        try {
            this.finalizeAtEnd();
        } catch (err: any) {
            this.haltWithError(`_final 中に例外が発生しました: ${err?.message}`);
        }

        callback();
    }

    /**
     * 内部バッファから解析可能な box を全て処理する
     */
    private processBuffer(): void {
        for (;;) {
            if (this.halted === true) {
                return;
            }

            const header = this.parseBoxHeader(this.buffer, 0);
            if (header === 'incomplete') {
                return;
            }
            if (header === 'invalid') {
                this.haltWithError('不正な box ヘッダを検出したため解析を停止します');

                return;
            }

            if (header.size === -1) {
                // size == 0: ファイル終端までの box。終端まで確定できないので保持して待つ
                this.pendingUnknownSizeBox = { type: header.type, headerSize: header.headerSize };

                return;
            }

            if (header.size > Fmp4Packager.MAX_BOX_SIZE) {
                this.haltWithError(
                    `box サイズが上限 (${Fmp4Packager.MAX_BOX_SIZE}) を超えているため解析を停止します (type=${header.type}, size=${header.size})`,
                );

                return;
            }

            if (this.buffer.length < header.size) {
                // box 全体がまだ揃っていない
                return;
            }

            const boxBuf = this.buffer.subarray(0, header.size);
            this.handleBox(header.type, boxBuf, header.headerSize);
            this.buffer = this.buffer.subarray(header.size);
        }
    }

    /**
     * box ヘッダを解析する
     * @return 'incomplete' データ不足で判定不能, 'invalid' 壊れたヘッダ, ParsedHeader 解析結果
     */
    private parseBoxHeader(buf: Buffer, offset: number): 'incomplete' | 'invalid' | Fmp4Packager.ParsedHeader {
        if (buf.length - offset < Fmp4Packager.BASIC_HEADER_SIZE) {
            return 'incomplete';
        }

        const size32 = buf.readUInt32BE(offset);
        const type = buf.toString('latin1', offset + 4, offset + 8);

        if (size32 === 1) {
            if (buf.length - offset < Fmp4Packager.LARGE_HEADER_SIZE) {
                return 'incomplete';
            }

            const largeSize = buf.readBigUInt64BE(offset + 8);
            if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                return 'invalid';
            }

            const size = Number(largeSize);
            if (size < Fmp4Packager.LARGE_HEADER_SIZE) {
                return 'invalid';
            }

            return { type, headerSize: Fmp4Packager.LARGE_HEADER_SIZE, size };
        }

        if (size32 === 0) {
            return { type, headerSize: Fmp4Packager.BASIC_HEADER_SIZE, size: -1 };
        }

        if (size32 < Fmp4Packager.BASIC_HEADER_SIZE) {
            // 2 〜 7 は ISO-BMFF 上あり得ないサイズ (予約値)
            return 'invalid';
        }

        return { type, headerSize: Fmp4Packager.BASIC_HEADER_SIZE, size: size32 };
    }

    /**
     * 1 つのトップレベル box を種別ごとに処理する
     */
    private handleBox(type: string, boxBuf: Buffer, headerSize: number): void {
        if (this.phase === 'waiting-ftyp') {
            if (type === 'ftyp') {
                this.ftypBuf = boxBuf;
                this.phase = 'waiting-moov';
            } else {
                this.log?.stream.warn(`ftyp より前に想定外の box (${type}) を検出したため保持します`);
                this.leadingExtra = Buffer.concat([this.leadingExtra, boxBuf]);
            }

            return;
        }

        if (this.phase === 'waiting-moov') {
            if (type === 'moov') {
                this.parseMoovTimescales(boxBuf, headerSize);
                this.setupMultiTrackIfNeeded(boxBuf, headerSize);

                const initData = Buffer.concat([this.leadingExtra, this.ftypBuf ?? Buffer.alloc(0), boxBuf]);
                this.leadingExtra = Buffer.alloc(0);
                this.phase = 'streaming';

                if (this.multiTrack === true) {
                    this.emitMultiTrackInit(boxBuf, headerSize);
                } else {
                    this.emit('init', initData);
                }
            } else if (type === 'moof' || type === 'mdat') {
                this.haltWithError(`moov より前に fragment (${type}) を検出したため解析を停止します`);
            } else {
                this.log?.stream.warn(`moov より前に想定外の box (${type}) を検出したため保持します`);
                this.leadingExtra = Buffer.concat([this.leadingExtra, boxBuf]);
            }

            return;
        }

        // streaming フェーズ
        if (this.multiTrack === true) {
            this.handleMultiTrackBox(type, boxBuf, headerSize);

            return;
        }

        if (type === 'moof') {
            if (this.pendingMoof !== null) {
                this.log?.stream.warn('mdat を伴わない moof を検出したため直前の moof を破棄します');
            }

            const { trackId, tfdt, timescale } = this.parseMoofFirstTraf(boxBuf, headerSize);
            this.pendingMoof = {
                buf: boxBuf,
                trackId,
                tfdt,
                timescale,
                extraPrefix: this.streamingExtra,
            };
            this.streamingExtra = Buffer.alloc(0);
        } else if (type === 'mdat') {
            if (this.pendingMoof === null) {
                this.log?.stream.warn('moof を伴わない mdat を検出したため破棄します');
                // 破棄する場合もバイト消失を明示するため extra として扱わない (検証時に不一致として現れる)
                return;
            }

            const partBuf = Buffer.concat([this.pendingMoof.extraPrefix, this.pendingMoof.buf, boxBuf]);
            this.finalizePart(this.pendingMoof.trackId, this.pendingMoof.tfdt, this.pendingMoof.timescale, partBuf);
            this.pendingMoof = null;
        } else {
            // mfra (moof 終了後の random access box) など。次の part に前置して出力する
            this.log?.stream.info(`streaming 中に box (${type}) を検出したため次 part に含めます`);
            this.streamingExtra = Buffer.concat([this.streamingExtra, boxBuf]);
        }
    }

    /**
     * moov 内を trak/mdia まで辿り、trackId -> timescale (mdhd) の対応表を作る
     */
    private parseMoovTimescales(moovBuf: Buffer, headerSize: number): void {
        this.trackTimescale = this.collectTrackTimescales(moovBuf, headerSize, moovBuf.length);
    }

    /**
     * moov の直下の trak を 1 つずつ取り出し、各 trak の tkhd(trackId) と mdia/mdhd(timescale) を対応付ける
     */
    private collectTrackTimescales(buf: Buffer, start: number, end: number): Map<number, number> {
        const result: Map<number, number> = new Map();

        this.forEachBox(buf, start, end, (type, bodyStart, boxEnd) => {
            if (type !== 'trak') {
                return;
            }

            let trackId: number | null = null;
            let timescale: number | null = null;

            this.forEachBox(buf, bodyStart, boxEnd, (childType, childBodyStart, childEnd) => {
                if (childType === 'tkhd') {
                    trackId = this.readTkhdTrackId(buf, childBodyStart);
                } else if (childType === 'mdia') {
                    this.forEachBox(buf, childBodyStart, childEnd, (mdiaChildType, mdiaChildBodyStart) => {
                        if (mdiaChildType === 'mdhd') {
                            timescale = this.readMdhdTimescale(buf, mdiaChildBodyStart);
                        }
                    });
                }
            });

            if (trackId !== null && timescale !== null) {
                result.set(trackId, timescale);
            } else {
                this.log?.stream.warn('trak から trackId または timescale を取得できませんでした');
            }
        });

        return result;
    }

    /**
     * moof 直下の最初の traf から trackId と tfdt (baseMediaDecodeTime) を取得する
     * 複数 traf (音声・映像を同一 moof に含む) が存在する構成には対応しない (最初の 1 つのみ使用)
     */
    private parseMoofFirstTraf(
        moofBuf: Buffer,
        headerSize: number,
    ): { trackId: number | null; tfdt: number | null; timescale: number | null } {
        let trackId: number | null = null;
        let tfdt: number | null = null;

        this.forEachBox(moofBuf, headerSize, moofBuf.length, (type, bodyStart, boxEnd, stopIteration) => {
            if (type !== 'traf') {
                return;
            }

            this.forEachBox(moofBuf, bodyStart, boxEnd, (childType, childBodyStart) => {
                if (childType === 'tfhd' && trackId === null) {
                    trackId = this.readTfhdTrackId(moofBuf, childBodyStart);
                } else if (childType === 'tfdt' && tfdt === null) {
                    tfdt = this.readTfdtBaseMediaDecodeTime(moofBuf, childBodyStart);
                }
            });

            // 最初の traf のみ使用する
            stopIteration();
        });

        const timescale = trackId !== null ? (this.trackTimescale.get(trackId) ?? null) : null;
        if (trackId === null || tfdt === null || timescale === null) {
            this.log?.stream.warn(
                `moof から継続時間算出に必要な情報を取得できませんでした (trackId=${trackId}, tfdt=${tfdt}, timescale=${timescale})`,
            );
        }

        return { trackId, tfdt, timescale };
    }

    // ============================================================
    // 複数音声トラック分解モード (multiTrack)
    //
    // ffmpeg が「映像 1 + 音声 2」を 1 本の fMP4 として出力した場合
    // (`-map 0:v:0 -map 0:a:0 -map 0:a:1`)、moov には trak が 3 つ、各 moof には
    // trackId ごとの traf が (通常は 1 つの moof にまとめて) 含まれる。
    // これを役割 (video / audio0 / audio1) ごとに独立した 2-trak 構成 (自身のみ) の
    // init / part / segment へ分解し、LL-HLS の別レンディションとして配信できるようにする。
    //
    // 分解対象は「音声 trak が 2 つ以上」のときだけで、従来の 1 映像 + 1 音声の入力は
    // this.multiTrack が false のまま従来の処理 (上の legacy コード) を通る。
    // ============================================================

    /**
     * moov を解析し、音声トラックが 2 本以上あれば複数音声トラック分解モードへ入る
     * @param moovBuf: Buffer moov box 全体 (header 含む)
     * @param headerSize: number moov のヘッダサイズ
     */
    private setupMultiTrackIfNeeded(moovBuf: Buffer, headerSize: number): void {
        const info = this.analyzeMoov(moovBuf, headerSize);

        const videoIds: number[] = [];
        const audioIds: number[] = [];
        for (const [trackId, track] of info.tracks) {
            if (track.mediaType === 'vide') {
                videoIds.push(trackId);
            } else if (track.mediaType === 'soun') {
                audioIds.push(trackId);
            }
        }
        videoIds.sort((a, b) => a - b);
        audioIds.sort((a, b) => a - b);

        if (audioIds.length < 2) {
            // 従来どおり (単一音声、または音声トラック無し)
            return;
        }

        this.trackRoleById = new Map();
        if (videoIds.length > 0) {
            this.trackRoleById.set(videoIds[0], 'video');
        }
        this.trackRoleById.set(audioIds[0], 'audio0');
        this.trackRoleById.set(audioIds[1], 'audio1');

        if (audioIds.length > 2) {
            this.log?.stream.warn(
                `音声トラックが ${audioIds.length} 本検出されましたが、先頭 2 本のみ配信します (trackIds=${audioIds.join(',')})`,
            );
        }

        this.multiTrack = true;
        for (const role of this.trackRoleById.values()) {
            this.mtTrackStates.set(role, {
                pendingSlot: null,
                lastDuration: null,
                currentSegmentParts: [],
            });
        }

        this.emit('multiTrack', [...this.trackRoleById.values()]);
    }

    /**
     * ロールごとの init (ftyp + moov(単一 trak)) を組み立てて emit する
     * @param moovBuf: Buffer moov box 全体 (header 含む)
     * @param headerSize: number moov のヘッダサイズ
     */
    private emitMultiTrackInit(moovBuf: Buffer, headerSize: number): void {
        const info = this.analyzeMoov(moovBuf, headerSize);
        const ftyp = this.ftypBuf ?? Buffer.alloc(0);

        for (const [trackId, role] of this.trackRoleById) {
            const track = info.tracks.get(trackId);
            if (typeof track === 'undefined') {
                continue;
            }

            const mvexChildren: Buffer[] = [];
            if (info.mehdBox !== null) {
                mvexChildren.push(info.mehdBox);
            }
            const trex = info.trexByTrack.get(trackId);
            if (typeof trex !== 'undefined') {
                mvexChildren.push(trex);
            }
            const mvexBox = this.buildBox('mvex', Buffer.concat(mvexChildren));

            const moovBody = Buffer.concat([info.mvhdBox ?? Buffer.alloc(0), track.trakBox, mvexBox]);
            const moovBox = this.buildBox('moov', moovBody);

            this.emit('trackInit', role, Buffer.concat([ftyp, moovBox]));
        }
    }

    /**
     * moov 内を解析し、mvhd / トラックごとの trak・mediaType・timescale / mvex(mehd・trexByTrack) を取り出す
     * @param moovBuf: Buffer moov box 全体 (header 含む)
     * @param headerSize: number moov のヘッダサイズ
     * @return Fmp4Packager.MoovInfo
     */
    private analyzeMoov(moovBuf: Buffer, headerSize: number): Fmp4Packager.MoovInfo {
        const children = this.listChildBoxes(moovBuf, headerSize, moovBuf.length);

        let mvhdBox: Buffer | null = null;
        let mehdBox: Buffer | null = null;
        const trexByTrack: Map<number, Buffer> = new Map();
        const tracks: Map<number, Fmp4Packager.MoovTrackInfo> = new Map();

        for (const child of children) {
            if (child.type === 'mvhd') {
                mvhdBox = child.box;
            } else if (child.type === 'trak') {
                const trakChildren = this.listChildBoxes(moovBuf, child.bodyStart, child.boxEnd);
                let trackId: number | null = null;
                let mediaType = '';
                let timescale: number | null = null;

                for (const trakChild of trakChildren) {
                    if (trakChild.type === 'tkhd') {
                        trackId = this.readTkhdTrackId(moovBuf, trakChild.bodyStart);
                    } else if (trakChild.type === 'mdia') {
                        const mdiaChildren = this.listChildBoxes(moovBuf, trakChild.bodyStart, trakChild.boxEnd);
                        for (const mdiaChild of mdiaChildren) {
                            if (mdiaChild.type === 'mdhd') {
                                timescale = this.readMdhdTimescale(moovBuf, mdiaChild.bodyStart);
                            } else if (mdiaChild.type === 'hdlr') {
                                mediaType = moovBuf.toString('latin1', mdiaChild.bodyStart + 8, mdiaChild.bodyStart + 12);
                            }
                        }
                    }
                }

                if (trackId !== null && timescale !== null) {
                    tracks.set(trackId, { trakBox: child.box, mediaType, timescale });
                }
            } else if (child.type === 'mvex') {
                const mvexChildren = this.listChildBoxes(moovBuf, child.bodyStart, child.boxEnd);
                for (const mvexChild of mvexChildren) {
                    if (mvexChild.type === 'mehd') {
                        mehdBox = mvexChild.box;
                    } else if (mvexChild.type === 'trex') {
                        // trex body = version(1)+flags(3)+track_id(4)+...
                        if (mvexChild.bodyStart + 8 <= moovBuf.length) {
                            const trackId = moovBuf.readUInt32BE(mvexChild.bodyStart + 4);
                            trexByTrack.set(trackId, mvexChild.box);
                        }
                    }
                }
            }
        }

        return { mvhdBox, mehdBox, trexByTrack, tracks };
    }

    /**
     * [start, end) 内のトップレベル box を配列で返す (box 全体のバイト列を含む)
     * 壊れた box を検出した場合はそこで走査を打ち切る (例外は投げない)
     */
    private listChildBoxes(
        buf: Buffer,
        start: number,
        end: number,
    ): { type: string; box: Buffer; boxStart: number; bodyStart: number; boxEnd: number }[] {
        const result: { type: string; box: Buffer; boxStart: number; bodyStart: number; boxEnd: number }[] = [];
        let offset = start;

        while (offset < end) {
            if (end - offset < Fmp4Packager.BASIC_HEADER_SIZE) {
                break;
            }

            let size = buf.readUInt32BE(offset);
            const type = buf.toString('latin1', offset + 4, offset + 8);
            let headerSize = Fmp4Packager.BASIC_HEADER_SIZE;

            if (size === 1) {
                if (end - offset < Fmp4Packager.LARGE_HEADER_SIZE) {
                    break;
                }
                const largeSize = buf.readBigUInt64BE(offset + 8);
                if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                    break;
                }
                size = Number(largeSize);
                headerSize = Fmp4Packager.LARGE_HEADER_SIZE;
            } else if (size === 0) {
                size = end - offset;
            }

            if (size < headerSize || offset + size > end) {
                break;
            }

            result.push({
                type,
                box: buf.subarray(offset, offset + size),
                boxStart: offset,
                bodyStart: offset + headerSize,
                boxEnd: offset + size,
            });
            offset += size;
        }

        return result;
    }

    /**
     * box を組み立てる (size(4) + type(4) + body)
     */
    private buildBox(type: string, body: Buffer): Buffer {
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8 + body.length, 0);
        header.write(type, 4, 'ascii');

        return Buffer.concat([header, body]);
    }

    /**
     * streaming フェーズ、複数音声トラック分解モードでの box 処理
     */
    private handleMultiTrackBox(type: string, boxBuf: Buffer, headerSize: number): void {
        if (type === 'moof') {
            if (this.mtPendingMoof !== null) {
                this.log?.stream.warn('mdat を伴わない moof を検出したため直前の moof を破棄します (multiTrack)');
            }

            const trafs: Map<number, Fmp4Packager.MtTrafInfo> = new Map();
            let mfhdBox: Buffer | null = null;
            const children = this.listChildBoxes(boxBuf, headerSize, boxBuf.length);
            for (const child of children) {
                if (child.type === 'mfhd') {
                    mfhdBox = child.box;
                } else if (child.type === 'traf') {
                    const trafInfo = this.parseTrafForSplit(boxBuf, child.bodyStart, child.boxEnd, child.box, child.boxStart);
                    if (trafInfo !== null) {
                        trafs.set(trafInfo.trackId, trafInfo);
                    }
                }
            }

            this.mtPendingMoof = { moofBoxBuf: boxBuf, mfhdBox, trafs };
            this.mtExtraBeforeMdat = Buffer.alloc(0);
        } else if (type === 'mdat') {
            if (this.mtPendingMoof === null) {
                this.log?.stream.warn('moof を伴わない mdat を検出したため破棄します (multiTrack)');

                return;
            }

            this.splitAndEmitMultiTrackFragment(this.mtPendingMoof, this.mtExtraBeforeMdat, boxBuf);
            this.mtPendingMoof = null;
            this.mtExtraBeforeMdat = Buffer.alloc(0);
        } else {
            this.log?.stream.info(`multiTrack streaming 中に box (${type}) を検出したため moof-mdat 間へ含めます`);
            this.mtExtraBeforeMdat = Buffer.concat([this.mtExtraBeforeMdat, boxBuf]);
        }
    }

    /**
     * traf から分解に必要な情報 (trackId, tfdt, timescale, トラック内バイト長, data_offset とその書き換え位置) を取り出す
     * @param moofBuf: Buffer moof box 全体 (header 含む)。オフセットはすべてこれを基準にする
     * @param trafBodyStart: number
     * @param trafBoxEnd: number
     * @param trafBox: Buffer traf box 全体のスライス (header 含む)
     * @param trafBoxStart: number moofBuf 内での traf box の開始位置
     */
    private parseTrafForSplit(
        moofBuf: Buffer,
        trafBodyStart: number,
        trafBoxEnd: number,
        trafBox: Buffer,
        trafBoxStart: number,
    ): Fmp4Packager.MtTrafInfo | null {
        let trackId: number | null = null;
        let defaultSampleSize: number | null = null;
        let tfdt: number | null = null;
        let trunInfo: { dataOffset: number | null; dataOffsetFieldOffset: number | null; byteLength: number } | null =
            null;

        const children = this.listChildBoxes(moofBuf, trafBodyStart, trafBoxEnd);
        for (const child of children) {
            if (child.type === 'tfhd') {
                const parsed = this.parseTfhdForSplit(moofBuf, child.bodyStart);
                trackId = parsed.trackId;
                defaultSampleSize = parsed.defaultSampleSize;
            } else if (child.type === 'tfdt') {
                tfdt = this.readTfdtBaseMediaDecodeTime(moofBuf, child.bodyStart);
            } else if (child.type === 'trun') {
                trunInfo = this.parseTrunForSplit(moofBuf, child.bodyStart, defaultSampleSize);
            }
        }

        const timescale = trackId !== null ? (this.trackTimescale.get(trackId) ?? null) : null;

        if (
            trackId === null ||
            tfdt === null ||
            timescale === null ||
            trunInfo === null ||
            trunInfo.dataOffset === null ||
            trunInfo.dataOffsetFieldOffset === null ||
            trunInfo.byteLength < 0
        ) {
            this.log?.stream.warn(
                `traf の分解に必要な情報を取得できませんでした (trackId=${trackId}, tfdt=${tfdt}, timescale=${timescale})`,
            );

            return null;
        }

        return {
            trackId,
            tfdt,
            timescale,
            trafBox: Buffer.from(trafBox),
            // trafBox 内での data_offset フィールドの相対位置 (moofBuf 座標 -> trafBox 座標)
            dataOffsetPatchOffset: trunInfo.dataOffsetFieldOffset - trafBoxStart,
            // moof 開始位置からの、このトラックのサンプルデータの相対位置 (base-data-offset = moof 開始)
            dataOffsetFromMoofStart: trunInfo.dataOffset,
            byteLength: trunInfo.byteLength,
        };
    }

    /**
     * tfhd を解析し trackId と default_sample_size を取り出す
     */
    private parseTfhdForSplit(buf: Buffer, bodyStart: number): { trackId: number | null; defaultSampleSize: number | null } {
        if (buf.length - bodyStart < 8) {
            return { trackId: null, defaultSampleSize: null };
        }

        const flags = buf.readUIntBE(bodyStart + 1, 3);
        let offset = bodyStart + 4;
        const trackId = buf.readUInt32BE(offset);
        offset += 4;

        if ((flags & 0x000001) !== 0) {
            // base-data-offset (64bit)
            offset += 8;
        }
        if ((flags & 0x000002) !== 0) {
            // sample-description-index
            offset += 4;
        }
        if ((flags & 0x000008) !== 0) {
            // default-sample-duration
            offset += 4;
        }
        let defaultSampleSize: number | null = null;
        if ((flags & 0x000010) !== 0 && buf.length - offset >= 4) {
            // default-sample-size
            defaultSampleSize = buf.readUInt32BE(offset);
        }

        return { trackId, defaultSampleSize };
    }

    /**
     * trun を解析し、data_offset (とその書き換え位置)、トラック内の総サンプルバイト数を求める
     * sample-size-present が無い場合は tfhd の default_sample_size × sample_count で代用する
     */
    private parseTrunForSplit(
        buf: Buffer,
        bodyStart: number,
        defaultSampleSize: number | null,
    ): { dataOffset: number | null; dataOffsetFieldOffset: number | null; byteLength: number } {
        if (buf.length - bodyStart < 8) {
            return { dataOffset: null, dataOffsetFieldOffset: null, byteLength: -1 };
        }

        const flags = buf.readUIntBE(bodyStart + 1, 3);
        const sampleCount = buf.readUInt32BE(bodyStart + 4);
        let offset = bodyStart + 8;

        let dataOffset: number | null = null;
        let dataOffsetFieldOffset: number | null = null;
        if ((flags & 0x000001) !== 0) {
            // data-offset-present
            dataOffsetFieldOffset = offset;
            dataOffset = buf.readInt32BE(offset);
            offset += 4;
        }
        if ((flags & 0x000004) !== 0) {
            // first-sample-flags-present
            offset += 4;
        }

        const sampleDurationPresent = (flags & 0x000100) !== 0;
        const sampleSizePresent = (flags & 0x000200) !== 0;
        const sampleFlagsPresent = (flags & 0x000400) !== 0;
        const sampleCtoPresent = (flags & 0x000800) !== 0;

        let byteLength = 0;
        if (sampleSizePresent === true) {
            for (let i = 0; i < sampleCount; i++) {
                if (sampleDurationPresent === true) {
                    offset += 4;
                }
                if (buf.length - offset < 4) {
                    return { dataOffset, dataOffsetFieldOffset, byteLength: -1 };
                }
                byteLength += buf.readUInt32BE(offset);
                offset += 4;
                if (sampleFlagsPresent === true) {
                    offset += 4;
                }
                if (sampleCtoPresent === true) {
                    offset += 4;
                }
            }
        } else if (defaultSampleSize !== null) {
            byteLength = defaultSampleSize * sampleCount;
        } else {
            byteLength = -1;
        }

        return { dataOffset, dataOffsetFieldOffset, byteLength };
    }

    /**
     * moof (全 traf 解析済み) + mdat から、ロールごとの 1 パート (単一 trak の moof + mdat) を組み立てて emit する
     */
    private splitAndEmitMultiTrackFragment(
        pendingMoof: NonNullable<Fmp4Packager['mtPendingMoof']>,
        extraBeforeMdat: Buffer,
        mdatBox: Buffer,
    ): void {
        // dataOffset (base-data-offset = moof 開始) はオリジナルのバイト列上の相対位置なので、
        // moof + (moof/mdat 間の余剰 box) + mdat を連結した仮想バッファでそのまま索引できる
        const fragBuf = Buffer.concat([pendingMoof.moofBoxBuf, extraBeforeMdat, mdatBox]);
        const mfhdBox = pendingMoof.mfhdBox ?? Buffer.alloc(0);

        for (const [trackId, role] of this.trackRoleById) {
            const traf = pendingMoof.trafs.get(trackId);
            if (typeof traf === 'undefined') {
                continue;
            }

            const trafBoxMutable = Buffer.from(traf.trafBox);
            const newMoofBodyLength = mfhdBox.length + trafBoxMutable.length;
            const newMoofSize = 8 + newMoofBodyLength;
            const newDataOffset = newMoofSize + 8; // + mdat header

            if (
                traf.dataOffsetPatchOffset < 0 ||
                traf.dataOffsetPatchOffset + 4 > trafBoxMutable.length
            ) {
                this.log?.stream.warn(`data_offset の書き換え位置が不正です (role=${role})`);
                continue;
            }
            trafBoxMutable.writeInt32BE(newDataOffset, traf.dataOffsetPatchOffset);

            const newMoofHeader = Buffer.alloc(8);
            newMoofHeader.writeUInt32BE(newMoofSize, 0);
            newMoofHeader.write('moof', 4, 'ascii');
            const newMoofBox = Buffer.concat([newMoofHeader, mfhdBox, trafBoxMutable]);

            const trackBytes = fragBuf.subarray(
                traf.dataOffsetFromMoofStart,
                traf.dataOffsetFromMoofStart + traf.byteLength,
            );
            const newMdatBox = this.buildBox('mdat', trackBytes);

            this.finalizeMultiTrackPart(role, traf.tfdt, traf.timescale, Buffer.concat([newMoofBox, newMdatBox]));
        }
    }

    /**
     * ロールの 1 パートを確定させる。継続時間は「前回このロールで確定したパートの tfdt」との差分で求まるため、
     * 1 パート分遅れて (次のパートが来たときに) 前回分を emit する
     */
    private finalizeMultiTrackPart(role: Fmp4PackagerTrackRole, tfdt: number, timescale: number, buf: Buffer): void {
        const state = this.mtTrackStates.get(role);
        if (typeof state === 'undefined') {
            return;
        }

        if (state.pendingSlot !== null) {
            const diff = tfdt - state.pendingSlot.tfdt;
            const duration = diff >= 0 && timescale > 0 ? diff / timescale : (state.lastDuration ?? 0);
            if (diff < 0) {
                this.log?.stream.warn(`tfdt が逆行しました (role=${role}, prev=${state.pendingSlot.tfdt}, cur=${tfdt})`);
            }
            state.lastDuration = duration;
            this.emitMultiTrackPart(
                role,
                state,
                state.pendingSlot.buf,
                duration,
                state.pendingSlot.tfdt,
                state.pendingSlot.timescale,
            );
        }

        state.pendingSlot = { buf, tfdt, timescale };
    }

    /**
     * 確定した 1 パートを emit する。emsg (ARIB 字幕) は video ロールのパートにのみ載せる
     * (LL-HLS ではロールごとに独立したパートとして配信されるため、字幕は映像側にのみ多重化すれば十分)
     */
    private emitMultiTrackPart(
        role: Fmp4PackagerTrackRole,
        state: Fmp4Packager.MtTrackState,
        buf: Buffer,
        duration: number,
        tfdt: number,
        timescale: number,
    ): void {
        const emsg = role === 'video' ? this.buildPendingEmsgBoxes(tfdt, timescale) : Buffer.alloc(0);

        const part: Fmp4PackagerPart = {
            data: emsg.length > 0 ? Buffer.concat([emsg, buf]) : buf,
            duration,
            isIndependent: state.currentSegmentParts.length === 0,
        };

        this.logGeneratedPart(role);

        state.currentSegmentParts.push(part);
        this.emit('trackPart', role, part);

        if (state.currentSegmentParts.length >= this.partsPerSegment) {
            this.flushMultiTrackSegment(role, state);
        }
    }

    private flushMultiTrackSegment(role: Fmp4PackagerTrackRole, state: Fmp4Packager.MtTrackState): void {
        if (state.currentSegmentParts.length === 0) {
            return;
        }

        const parts = state.currentSegmentParts;
        state.currentSegmentParts = [];

        const segment: Fmp4PackagerSegment = {
            data: Buffer.concat(parts.map(p => p.data)),
            duration: parts.reduce((sum, p) => sum + p.duration, 0),
            parts,
        };

        this.emit('trackSegment', role, segment);
    }

    /**
     * ストリーム終端で、複数音声トラック分解モードの残りパート・セグメントを確定させる
     */
    private finalizeMultiTrackAtEnd(): void {
        if (this.mtPendingMoof !== null) {
            this.log?.stream.warn('ストリーム終端で mdat を伴わない moof (multiTrack) が残ったため破棄します');
            this.mtPendingMoof = null;
        }

        for (const [role, state] of this.mtTrackStates) {
            if (state.pendingSlot !== null) {
                const duration = state.lastDuration ?? 0;
                this.emitMultiTrackPart(
                    role,
                    state,
                    state.pendingSlot.buf,
                    duration,
                    state.pendingSlot.tfdt,
                    state.pendingSlot.timescale,
                );
                state.pendingSlot = null;
            }
            this.flushMultiTrackSegment(role, state);
        }
    }

    private readTkhdTrackId(buf: Buffer, bodyStart: number): number | null {
        if (buf.length - bodyStart < 1) {
            return null;
        }
        const version = buf.readUInt8(bodyStart);
        const offset = version === 1 ? bodyStart + 4 + 8 + 8 : bodyStart + 4 + 4 + 4;
        if (buf.length - offset < 4) {
            return null;
        }

        return buf.readUInt32BE(offset);
    }

    private readMdhdTimescale(buf: Buffer, bodyStart: number): number | null {
        if (buf.length - bodyStart < 1) {
            return null;
        }
        const version = buf.readUInt8(bodyStart);
        const offset = version === 1 ? bodyStart + 4 + 8 + 8 : bodyStart + 4 + 4 + 4;
        if (buf.length - offset < 4) {
            return null;
        }

        const timescale = buf.readUInt32BE(offset);

        return timescale > 0 ? timescale : null;
    }

    private readTfhdTrackId(buf: Buffer, bodyStart: number): number | null {
        const offset = bodyStart + 4;
        if (buf.length - offset < 4) {
            return null;
        }

        return buf.readUInt32BE(offset);
    }

    private readTfdtBaseMediaDecodeTime(buf: Buffer, bodyStart: number): number | null {
        if (buf.length - bodyStart < 1) {
            return null;
        }
        const version = buf.readUInt8(bodyStart);

        if (version === 1) {
            if (buf.length - (bodyStart + 4) < 8) {
                return null;
            }
            const big = buf.readBigUInt64BE(bodyStart + 4);

            return big > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(big);
        }

        if (buf.length - (bodyStart + 4) < 4) {
            return null;
        }

        return buf.readUInt32BE(bodyStart + 4);
    }

    /**
     * [start, end) の範囲内にあるトップレベル box を順に visitor へ渡す
     * visitor には (type, bodyStart, boxEnd, stopIteration) を渡す。stopIteration() を呼ぶと以降の兄弟を走査しない
     * 壊れた box を検出した場合はその場で走査を打ち切る (例外は投げない)
     */
    private forEachBox(
        buf: Buffer,
        start: number,
        end: number,
        visitor: (type: string, bodyStart: number, boxEnd: number, stopIteration: () => void) => void,
    ): void {
        let offset = start;
        let stopped = false;
        const stopIteration = () => {
            stopped = true;
        };

        while (offset < end && stopped === false) {
            if (end - offset < Fmp4Packager.BASIC_HEADER_SIZE) {
                this.log?.stream.warn('box 階層の走査中に不完全なヘッダを検出したため打ち切ります');

                return;
            }

            let size = buf.readUInt32BE(offset);
            const type = buf.toString('latin1', offset + 4, offset + 8);
            let headerSize = Fmp4Packager.BASIC_HEADER_SIZE;

            if (size === 1) {
                if (end - offset < Fmp4Packager.LARGE_HEADER_SIZE) {
                    this.log?.stream.warn('box 階層の走査中に不完全な largesize を検出したため打ち切ります');

                    return;
                }
                const largeSize = buf.readBigUInt64BE(offset + 8);
                if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                    this.log?.stream.warn('box 階層の走査中に過大な largesize を検出したため打ち切ります');

                    return;
                }
                size = Number(largeSize);
                headerSize = Fmp4Packager.LARGE_HEADER_SIZE;
            } else if (size === 0) {
                size = end - offset;
            }

            if (size < headerSize || offset + size > end) {
                this.log?.stream.warn(`box 階層の走査中に不正なサイズを検出したため打ち切ります (type=${type})`);

                return;
            }

            visitor(type, offset + headerSize, offset + size, stopIteration);
            offset += size;
        }
    }

    /**
     * moof+mdat が揃った 1 パートを確定させ、可能であれば継続時間を計算した上で待ち行列に積む
     */
    private finalizePart(trackId: number | null, tfdt: number | null, timescale: number | null, buf: Buffer): void {
        const slot: Fmp4Packager.PartSlot = {
            trackId,
            tfdt,
            timescale,
            buf,
            duration: null,
        };

        if (trackId !== null && tfdt !== null && timescale !== null && timescale > 0) {
            const prev = this.lastSlotByTrack.get(trackId);
            if (typeof prev !== 'undefined' && prev.tfdt !== null) {
                const diff = tfdt - prev.tfdt;
                if (diff >= 0) {
                    prev.duration = diff / timescale;
                    this.lastDurationByTrack.set(trackId, prev.duration);
                } else {
                    this.log?.stream.warn(
                        `tfdt が逆行しました (trackId=${trackId}, prev=${prev.tfdt}, cur=${tfdt})。継続時間算出をスキップします`,
                    );
                }
            }
            this.lastSlotByTrack.set(trackId, slot);
        } else {
            this.log?.stream.warn('trackId/tfdt/timescale が不明なため継続時間を算出できないパートがあります');
        }

        this.slotQueue.push(slot);
        this.drainReadySlots();
    }

    /**
     * 待ち行列の先頭から、継続時間が確定済みの part を順番に emit する
     */
    private drainReadySlots(): void {
        while (this.slotQueue.length > 0 && this.slotQueue[0].duration !== null) {
            const slot = this.slotQueue.shift() as Fmp4Packager.PartSlot;
            this.emitPart(slot);
        }
    }

    /**
     * 確定した 1 パートを emit し、partsPerSegment 個貯まったらセグメントとして emit する
     */
    private emitPart(slot: Fmp4Packager.PartSlot): void {
        // ARIB 字幕 (ID3 timed metadata) はパート先頭の emsg box として多重化する。
        // LL-HLS ではパートが単独で配信されるため、セグメント確定まで待つと
        // パート経由で再生しているプレイヤーに字幕が届かない
        const emsg = this.buildPendingEmsgBoxes(slot.tfdt, slot.timescale);

        const part: Fmp4PackagerPart = {
            data: emsg.length > 0 ? Buffer.concat([emsg, slot.buf]) : slot.buf,
            duration: slot.duration as number,
            isIndependent: this.currentSegmentParts.length === 0,
        };

        this.logGeneratedPart();

        this.currentSegmentParts.push(part);
        this.emit('part', part);

        if (this.currentSegmentParts.length >= this.partsPerSegment) {
            this.flushSegment();
        }
    }

    /**
     * 現在組み立て中のセグメントを確定させ emit する
     */
    private flushSegment(): void {
        if (this.currentSegmentParts.length === 0) {
            return;
        }

        const parts = this.currentSegmentParts;
        this.currentSegmentParts = [];

        // emsg (ARIB 字幕) は emitPart() でパート側に載せてあるため、ここは単純連結でよい
        const segment: Fmp4PackagerSegment = {
            data: Buffer.concat(parts.map(p => p.data)),
            duration: parts.reduce((sum, p) => sum + p.duration, 0),
            parts,
        };

        this.emit('segment', segment);
    }

    /**
     * ストリーム終端で呼ばれる。保留中のデータをできる範囲で確定させる
     */
    private finalizeAtEnd(): void {
        if (this.halted === true) {
            return;
        }

        // size == 0 (末尾まで) の box が保留されていた場合、残りバッファ全体をその box として扱う
        if (this.pendingUnknownSizeBox !== null) {
            const { type, headerSize } = this.pendingUnknownSizeBox;
            this.pendingUnknownSizeBox = null;
            if (this.buffer.length >= headerSize) {
                this.handleBox(type, this.buffer, headerSize);
                this.buffer = Buffer.alloc(0);
            } else {
                this.log?.stream.warn('size=0 の box を終端処理できませんでした (データ不足)');
            }
        }

        if (this.buffer.length > 0) {
            this.log?.stream.warn(`ストリーム終端に未処理の端数データが ${this.buffer.length} byte 残りました (破棄)`);
            this.buffer = Buffer.alloc(0);
        }

        if (this.multiTrack === true) {
            if (this.mtExtraBeforeMdat.length > 0) {
                this.log?.stream.warn(
                    `ストリーム終端で mdat を伴わない moof (multiTrack) の後続 box が残ったため破棄します (${this.mtExtraBeforeMdat.length} byte)`,
                );
                this.mtExtraBeforeMdat = Buffer.alloc(0);
            }
            this.finalizeMultiTrackAtEnd();

            this.log?.stream.info(
                `[Fmp4Packager] ${this.mode} packaging summary: parts=${this.generatedPartCount}, ` +
                    `pendingMetadata=${this.pendingId3.length}, emsgBytes=${this.attachedEmsgBytes}`,
            );

            return;
        }

        // mdat が来ないまま終了した moof は破棄する
        if (this.pendingMoof !== null) {
            this.log?.stream.warn('ストリーム終端で mdat を伴わない moof が残ったため破棄します');
            this.pendingMoof = null;
        }

        // 継続時間が確定しないまま残っている末尾パートは、同トラックの直近継続時間を流用して確定させる
        for (const slot of this.slotQueue) {
            if (slot.duration === null) {
                const fallback = slot.trackId !== null ? this.lastDurationByTrack.get(slot.trackId) : undefined;
                slot.duration = typeof fallback === 'number' ? fallback : 0;
                this.log?.stream.warn(
                    `末尾パートの継続時間を確定できないため推定値 (${slot.duration}s) を使用します (trackId=${slot.trackId})`,
                );
            }
        }

        while (this.slotQueue.length > 0) {
            const slot = this.slotQueue.shift() as Fmp4Packager.PartSlot;
            this.emitPart(slot);
        }

        // 端数のセグメントも確定させて出力する
        this.flushSegment();

        this.log?.stream.info(
            `[Fmp4Packager] ${this.mode} packaging summary: parts=${this.generatedPartCount}, ` +
                `pendingMetadata=${this.pendingId3.length}, emsgBytes=${this.attachedEmsgBytes}`,
        );

        // 最後の part の後に mfra 等の box が残っている場合、どの part にも属さないため
        // 個別イベントとして通知する (バイト取りこぼしがないことの検証用)
        if (this.streamingExtra.length > 0) {
            this.log?.stream.info(
                `末尾に付随する box (${this.streamingExtra.length} byte) を trailer として通知します`,
            );
            this.emit('trailer', this.streamingExtra);
            this.streamingExtra = Buffer.alloc(0);
        }
    }

    /**
     * 破損入力等により解析継続が不可能と判断した場合に呼ぶ
     * 例外は投げず、ログを残して以後の解析を停止する
     */
    private haltWithError(message: string): void {
        if (this.halted === true) {
            return;
        }

        this.halted = true;
        this.buffer = Buffer.alloc(0);
        this.log?.stream.error(`[Fmp4Packager] ${message}`);
        // Writable 標準の 'error' イベントは listener が無いと Node が例外を投げてプロセスを落とすため、
        // ストリーム全体を巻き込まないよう独自イベント名で通知するに留める
        this.emit('halted', message);
    }
}

namespace Fmp4Packager {
    // 1 セグメントを構成するパート数の既定値
    export const DEFAULT_PARTS_PER_SEGMENT = 3;
    // hls.js が ID3 として解釈する emsg の scheme_id_uri
    export const EMSG_SCHEME_ID_URI = 'https://aomedia.org/emsg/ID3';
    // MPEG-2 TS の PTS の周波数
    export const PTS_TIMESCALE = 90000;
    // これ以上離れた相対時刻は不正な PTS と見なして 0 に丸める (90kHz で 30 秒)
    export const MAX_EMSG_DELTA = PTS_TIMESCALE * 30;
    // 保留できる ID3 timed metadata の上限
    export const MAX_PENDING_ID3 = 100;
    // box ヘッダの基本サイズ (size(4) + type(4))
    export const BASIC_HEADER_SIZE = 8;
    // largesize を含む box ヘッダのサイズ (size(4) + type(4) + largesize(8))
    export const LARGE_HEADER_SIZE = 16;
    // 1 box として許容する最大サイズ (これを超える場合は壊れた入力とみなす)
    export const MAX_BOX_SIZE = 512 * 1024 * 1024; // 512MB

    export interface ParsedHeader {
        type: string;
        headerSize: number;
        // -1 の場合は size == 0 (末尾まで) を意味する
        size: number;
    }

    export interface PartSlot {
        trackId: number | null;
        tfdt: number | null;
        timescale: number | null;
        buf: Buffer;
        duration: number | null;
    }

    // moov 解析で得た、1 トラック分の情報
    export interface MoovTrackInfo {
        // trak box 全体のバイト列 (header 含む)
        trakBox: Buffer;
        // mdia/hdlr の handler_type ('vide' | 'soun' | その他)
        mediaType: string;
        timescale: number;
    }

    // moov 解析結果 (複数音声トラック分解モードの init 組み立てに使う)
    export interface MoovInfo {
        mvhdBox: Buffer | null;
        mehdBox: Buffer | null;
        trexByTrack: Map<number, Buffer>;
        tracks: Map<number, MoovTrackInfo>;
    }

    // 複数音声トラック分解モードでの traf 解析結果
    export interface MtTrafInfo {
        trackId: number;
        tfdt: number;
        timescale: number;
        // traf box 全体のコピー (header 含む)
        trafBox: Buffer;
        // trafBox 内で trun の data_offset フィールドを書き換えるための相対位置
        dataOffsetPatchOffset: number;
        // moof 開始位置からの、このトラックのサンプルデータの相対位置 (オリジナルのバイト列上)
        dataOffsetFromMoofStart: number;
        // このトラックのサンプルデータの総バイト数
        byteLength: number;
    }

    // 複数音声トラック分解モードでの、ロールごとの状態
    export interface MtTrackState {
        // 継続時間が未確定のまま保持している直近のパート (次のパートの tfdt で確定する)
        pendingSlot: { buf: Buffer; tfdt: number; timescale: number } | null;
        // 直近確定した継続時間 (終端パートのフォールバックに使う)
        lastDuration: number | null;
        // 組み立て中のセグメントを構成する part
        currentSegmentParts: Fmp4PackagerPart[];
    }
}

export default Fmp4Packager;
