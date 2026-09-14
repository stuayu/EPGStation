import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import Mp4CodecUtil from '../llhls/Mp4CodecUtil';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IHLSMemoryStoreModel, {
    HLSMasterAudioTrack,
    HLSMemoryPart,
    HLSMemorySegment,
    HLSMemoryStoreMode,
    HLSMemoryTrackRole,
    HLSPlaylistRequest,
} from './IHLSMemoryStoreModel';

interface HLSMemoryWaiter {
    // 待機対象 (この seq / index のパートが生成されたら解決する)
    seq: number;
    index: number;
    resolve: () => void;
    timerId: ReturnType<typeof setTimeout>;
}

interface HLSMemoryStreamEntry {
    mode: HLSMemoryStoreMode;
    init: Buffer | null;
    segments: HLSMemorySegment[];
    nextSeq: number;
    // 組み立て中 (未確定) のセグメント。パートだけが先に載る
    pending: HLSMemorySegment | null;
    // パート生成待ちの待機者
    waiters: HLSMemoryWaiter[];
    // クライアントが実際に取得した最新のセグメント seq (未取得なら null)。
    // 録画済み配信で「エンコードがどれだけ再生位置より先行しているか」を測るのに使う
    lastServedSeq: number | null;
    // 取得済みの seq。未取得のセグメントを保持上限によって削除しないために使う
    servedSeqs: Set<number>;
    // エンコードが正常終了し、これ以上セグメントが増えないか (#EXT-X-ENDLIST を出す)
    ended: boolean;
    // LL-HLS で公開するパートの基準長。ストリーム中は変更しない
    partTarget: number | null;
}

/**
 * ライブ / 録画済み HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * tmpfs など OS 依存の仕組みを使わないため Windows でも動作する
 *
 * **ライブ (mode === 'live') は LL-HLS (RFC 8216bis)**。セグメントが確定する前でも
 * パート (#EXT-X-PART) をプレイリストへ載せて配信し、ブロッキングプレイリスト要求
 * (_HLS_msn / _HLS_part) と #EXT-X-PRELOAD-HINT で先行要求されたパートの待機にも応える。
 *
 * **録画済み (mode === 'recorded') は通常の HLS**。パート (#EXT-X-PART /
 * #EXT-X-PRELOAD-HINT) は出さない (`getRecordedPlaylist()`)。WebKit のネイティブ HLS が
 * LL-HLS のプレイリストに対して、再生位置のセグメントと同時にライブ端のパート
 * (#EXT-X-PRELOAD-HINT) も先取りする挙動が実測で確認されており、これが
 * `markServedSeq()` (lastServedSeq) をライブ端へ跳ねさせて `getAheadSegmentNum()` の
 * エンコード抑制 (RecordedStreamBaseModel) を無効化し、かつ保持窓 (lastServedSeq から遡った
 * KEEP_BEHIND) が実際の再生位置のセグメントを追い越して削除してしまう不具合の原因だった
 * (詳細・実測値は doc/streaming-refresh.md、doc/changelog-fork.md 2026-09-12 を参照)
 *
 * **複数音声トラック分解モード**: Fmp4Packager が音声トラック 2 本以上を検出すると、
 * 映像 (role: 'v') と音声 (role: 'a0' / 'a1') を別々のエントリとして保持する
 * (キーは `${streamId}:${role}`)。role を省略した呼び出しは従来どおり単一トラックの
 * エントリを指す (キーは `${streamId}`) ため、単一音声の配信は一切影響を受けない
 */
@injectable()
export default class HLSMemoryStoreModel implements IHLSMemoryStoreModel {
    // プレイリストに載せるセグメント数 (ライブウィンドウ)
    // セグメントは約 1 秒なので、6 本で約 6 秒分のウィンドウになる
    private static readonly LIVE_PLAYLIST_WINDOW_NUM = 6;
    // メモリ上に保持するセグメント数 (取得が遅れたプレイヤー向けにウィンドウより多めに残す)
    private static readonly LIVE_RETAIN_SEGMENT_NUM = 12;
    // 録画済み配信で、再生位置 (lastServedSeq) がまだ判明していない間の保持セグメント数。
    // 判明した後は RECORDED_KEEP_BEHIND_SEGMENT_NUM を基準にするため、
    // この値はプレイリスト開始直後 (再生位置不明) の間だけ使われるフォールバック
    private static readonly RECORDED_RETAIN_SEGMENT_NUM = 180;
    // 録画済み配信で、再生位置 (lastServedSeq) からどれだけ過去のセグメントまで保持するか。
    //
    // 実測 (Safari ネイティブ HLS) では再生位置から約 50〜60 秒先まで取得・バッファするため、
    // それより手前のセグメントを破棄すると保持窓の先頭が再生位置を追い越し、
    // hls.js / ネイティブ HLS が現在位置を「範囲外」と判定してライブエッジへ強制シークする
    // (これが「5 分ほど再生すると位置が飛ぶ」不具合の原因だった)。
    // Safari の先読み量 + 巻き戻し操作の余裕を見て 120 秒分 (約 2 分) を確保する
    private static readonly RECORDED_KEEP_BEHIND_SEGMENT_NUM = 120;
    // 録画済み配信のメモリ使用量の安全弁。lastServedSeq が長時間進まない異常系でも
    // セグメントを無制限に保持し続けないための絶対上限 (KEEP_BEHIND + エンコード先行上限 に
    // 十分な余裕を足した値)
    private static readonly RECORDED_MAX_SEGMENT_NUM = 400;
    // マスタープレイリストの BANDWIDTH の既定値 (まだセグメントが無く実測できないとき)
    private static readonly DEFAULT_BANDWIDTH = 3000000;
    // ライブはライブエッジへ張り付けないため 2 本必要。録画済みは先頭固定の通常 HLS なので
    // 1 本目を取得可能になった時点で開始できる。
    private static readonly READY_SEGMENT_NUM = 2;
    // #EXT-X-PART を載せるセグメント数 (プレイリスト末尾から数えて)
    // 仕様上 PART-HOLD-BACK より前のパートは不要なので、直近数セグメント分だけでよい
    private static readonly PART_WINDOW_SEGMENT_NUM = 3;
    // ブロッキングプレイリスト要求・パート先行要求の待機上限 (ミリ秒)
    // HLS 仕様の推奨に従い TARGETDURATION の 3 倍程度で打ち切る
    private static readonly BLOCK_TIMEOUT: number = 6000;
    // 待機中の要求が要求できる先読み範囲 (これより先の msn は即座に応答して暴走を防ぐ)
    private static readonly MAX_LOOKAHEAD_SEGMENT_NUM = 3;

    private log: ILogger;
    private entries: Map<string, HLSMemoryStreamEntry> = new Map();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * ストア内部のキーを組み立てる。role 省略時は従来どおり streamId のみ
     */
    private key(streamId: apid.StreamId, role?: HLSMemoryTrackRole): string {
        return typeof role === 'undefined' ? `${streamId}` : `${streamId}:${role}`;
    }

    /**
     * 配信ファイル名に使うタグ (URI の streamId 直後に付く文字列)。role 省略時は空文字列
     */
    private fileTag(role?: HLSMemoryTrackRole): string {
        return typeof role === 'undefined' ? '' : role;
    }

    public create(streamId: apid.StreamId, mode: HLSMemoryStoreMode = 'live', role?: HLSMemoryTrackRole): void {
        const key = this.key(streamId, role);
        this.log.stream.info(`create in-memory HLS store: ${key} (${mode})`);
        this.entries.set(key, {
            mode: mode,
            init: null,
            segments: [],
            nextSeq: 0,
            pending: null,
            waiters: [],
            lastServedSeq: null,
            servedSeqs: new Set(),
            ended: false,
            partTarget: null,
        });
    }

    public has(streamId: apid.StreamId, role?: HLSMemoryTrackRole): boolean {
        return this.entries.has(this.key(streamId, role));
    }

    public setInit(streamId: apid.StreamId, data: Buffer, role?: HLSMemoryTrackRole): void {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return;
        }

        entry.init = data;
    }

    public addPart(
        streamId: apid.StreamId,
        data: Buffer,
        duration: number,
        isIndependent: boolean,
        role?: HLSMemoryTrackRole,
    ): void {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return;
        }

        if (entry.pending === null) {
            entry.pending = {
                seq: entry.nextSeq,
                data: null,
                duration: 0,
                parts: [],
                complete: false,
            };
        }

        const part: HLSMemoryPart = {
            index: entry.pending.parts.length,
            data: data,
            duration: duration,
            isIndependent: isIndependent,
        };
        entry.pending.parts.push(part);
        entry.pending.duration += duration;

        this.resolveWaiters(entry, entry.pending.seq, part.index);
    }

    public addSegment(streamId: apid.StreamId, data: Buffer, duration: number, role?: HLSMemoryTrackRole): void {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return;
        }

        // addPart を経由していない場合 (パート非対応の呼び出し) はセグメント全体を 1 パートとして扱う
        if (entry.pending === null) {
            this.addPart(streamId, data, duration, true, role);
        }

        const segment = entry.pending;
        if (segment === null) {
            return;
        }

        segment.data = data;
        segment.duration = duration;
        segment.complete = true;
        entry.segments.push(segment);
        entry.pending = null;
        entry.nextSeq += 1;

        // 先頭セグメントは不揃いな初回 GOP を含むことがあるため通常 HLS のみで公開する。
        // 2 本目の実測から PART-TARGET を決め、以後はストリーム中で固定する。
        if (entry.partTarget === null && segment.parts.length > 0 && segment.seq > 0) {
            const nonTailParts = segment.parts.slice(0, -1);
            const candidate =
                nonTailParts.length > 0
                    ? Math.max(...nonTailParts.map(part => part.duration))
                    : segment.parts[0].duration;
            entry.partTarget = Math.ceil(candidate * 1000) / 1000;
        }

        // 保持上限を超えた古いセグメントは破棄する
        this.trimOldSegments(entry);

        // セグメント確定もプレイリスト更新なので、待機中の要求を解決する
        this.resolveWaiters(entry, segment.seq, segment.parts.length - 1);
    }

    public isReady(streamId: apid.StreamId, role?: HLSMemoryTrackRole): boolean {
        const entry = this.entries.get(this.key(streamId, role));
        const readySegmentNum = entry?.mode === 'recorded' ? 1 : HLSMemoryStoreModel.READY_SEGMENT_NUM;

        return typeof entry !== 'undefined' && entry.init !== null && entry.segments.length >= readySegmentNum;
    }

    public getPlaylist(streamId: apid.StreamId, role?: HLSMemoryTrackRole): string | null {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined' || entry.init === null || entry.segments.length === 0) {
            return null;
        }

        const tag = this.fileTag(role);

        // 録画済みは LL-HLS にしない (getRecordedPlaylist() のコメント参照)。
        // **複数音声トラック分解モード (role あり) も LL-HLS にしない**: 映像 + 音声 2 本を
        // それぞれ #EXT-X-PART 付きのレンディションとして配ると、Safari のネイティブ HLS が
        // 音声レンディションを先頭セグメントまでしか取得せず再生位置が進まない
        // (実測: WebKit 26 で currentTime が 0.45 秒から動かず readyState=2 のまま。
        // 映像側はパートまで取得できているので、レンディション間のパート同期が原因)。
        // 通常の HLS (1 セグメント = 約 1 秒) にすると再生できる
        if (entry.mode === 'recorded' || typeof role !== 'undefined') {
            return this.getRecordedPlaylist(streamId, tag, entry);
        }

        const windowSegments = entry.segments.slice(-this.getPlaylistWindowNum(entry));

        // TARGETDURATION はプレイリスト内の最大継続時間の切り上げ (最低 1)
        let maxDuration = 0;
        let hasPublishedPart = false;
        for (const seg of windowSegments) {
            if (seg.duration > maxDuration) {
                maxDuration = seg.duration;
            }
            if (this.getPublicParts(seg, entry.partTarget).length > 0) hasPublishedPart = true;
        }
        const targetDuration = Math.max(1, Math.ceil(maxDuration));
        const partTarget = entry.partTarget;
        // パートがまだ 1 つも公開できない間は LL-HLS 属性を出さない。
        if (partTarget === null || hasPublishedPart === false) {
            return this.getRegularLivePlaylist(streamId, tag, windowSegments, entry, targetDuration);
        }
        // PART-HOLD-BACK は PART-TARGET の 3 倍以上であることが要求される
        const partHoldBack = Math.round(partTarget * 3 * 1000) / 1000;

        const lines: string[] = [
            '#EXTM3U',
            // #EXT-X-PART / #EXT-X-PRELOAD-HINT の解釈には version 9 以上が必要
            '#EXT-X-VERSION:9',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            `#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=${partHoldBack.toFixed(3)}`,
            `#EXT-X-PART-INF:PART-TARGET=${partTarget.toFixed(3)}`,
            `#EXT-X-MEDIA-SEQUENCE:${windowSegments[0].seq}`,
            `#EXT-X-MAP:URI="stream${streamId}${tag}-init.mp4"`,
        ];
        // ライブ (mode === 'live') はこの先固定。録画済み (mode === 'recorded') は getRecordedPlaylist() が別処理する

        // #EXT-X-PART を載せる範囲 (プレイリスト末尾から PART_WINDOW_SEGMENT_NUM 分)
        const partWindowStartSeq =
            windowSegments[windowSegments.length - 1].seq - (HLSMemoryStoreModel.PART_WINDOW_SEGMENT_NUM - 1);

        for (const seg of windowSegments) {
            if (seg.seq >= partWindowStartSeq) {
                for (const part of this.getPublicParts(seg, partTarget)) {
                    lines.push(this.buildPartLine(streamId, tag, seg.seq, part));
                }
            }
            lines.push(`#EXTINF:${seg.duration.toFixed(5)},`);
            lines.push(`stream${streamId}${tag}-${seg.seq}.m4s`);
        }

        // 組み立て中セグメントのパート (セグメント確定を待たずに再生できるようにする)
        const pending = entry.pending;
        const nextSeq = pending === null ? entry.nextSeq : pending.seq;
        const nextPartIndex = pending === null ? 0 : pending.parts.length;
        const publicPendingParts = pending === null ? [] : this.getPublicParts(pending, partTarget);
        if (pending !== null && publicPendingParts.length === pending.parts.length) {
            for (const part of publicPendingParts) {
                lines.push(this.buildPartLine(streamId, tag, pending.seq, part));
            }
        }

        if (entry.ended === true) {
            // エンコードが正常終了し、これ以上セグメントが増えないことをプレイヤーへ伝える。
            // 待機中のブロッキング要求は markEnded() で解決済みなので PRELOAD-HINT は出さない
            lines.push('#EXT-X-ENDLIST');
        } else if (pending === null || publicPendingParts.length === pending.parts.length) {
            // 次に生成されるパートを先行要求させる (プレイヤーはこの URI へ即座に接続して待機する)
            lines.push(
                `#EXT-X-PRELOAD-HINT:TYPE=PART,URI="${this.buildPartFileName(streamId, tag, nextSeq, nextPartIndex)}"`,
            );
        }

        return lines.join('\n') + '\n';
    }

    private isPublicPart(part: HLSMemoryPart, partTarget: number): boolean {
        return part.duration <= partTarget && part.duration >= partTarget * 0.85;
    }

    private getPublicParts(segment: HLSMemorySegment, partTarget: number | null): HLSMemoryPart[] {
        if (partTarget === null) return [];
        const isValid = segment.parts.every(
            (part, index) =>
                part.duration <= partTarget &&
                (index === segment.parts.length - 1 || this.isPublicPart(part, partTarget)),
        );
        return isValid ? segment.parts : [];
    }

    private getRegularLivePlaylist(
        streamId: apid.StreamId,
        tag: string,
        segments: HLSMemorySegment[],
        entry: HLSMemoryStreamEntry,
        targetDuration: number,
    ): string {
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            `#EXT-X-MEDIA-SEQUENCE:${segments[0].seq}`,
            `#EXT-X-MAP:URI="stream${streamId}${tag}-init.mp4"`,
        ];
        for (const segment of segments) {
            lines.push(`#EXTINF:${segment.duration.toFixed(5)},`);
            lines.push(`stream${streamId}${tag}-${segment.seq}.m4s`);
        }
        if (entry.ended === true) lines.push('#EXT-X-ENDLIST');
        return lines.join('\n') + '\n';
    }

    /**
     * 録画済み配信 (mode === 'recorded') と複数音声トラック分解モード用の
     * 通常 (非 LL) HLS メディアプレイリストを組み立てる
     *
     * **録画済み HLS は LL-HLS (#EXT-X-PART / #EXT-X-PRELOAD-HINT) にしない**。
     * WebKit (Safari) のネイティブ HLS は LL-HLS のプレイリストに対して、再生位置のセグメントと
     * 同時にライブ端の #EXT-X-PRELOAD-HINT (次パート) も先取りする挙動が実測で確認できており、
     * これが `markServedSeq()` (lastServedSeq) をライブ端へ跳ねさせ、`getAheadSegmentNum()` に基づく
     * エンコード抑制 (RecordedStreamBaseModel) を無効化していた
     * (実測: 9.8 分の録画エンコードが 28 秒で完了し、保持窓 (lastServedSeq - 120) が
     * 再生位置を追い越して 180 秒地点で再生が止まったまま戻らなくなる)。
     *
     * **複数音声トラック分解モード (role あり) も LL-HLS にしない**。映像・音声をそれぞれ
     * #EXT-X-PART 付きのレンディションとして配ると、Safari のネイティブ HLS が音声レンディションを
     * 先頭セグメントまでしか取得せず再生位置が進まない (実測: WebKit 26 で currentTime が
     * 0.45 秒から動かず readyState=2 のまま)
     * @param streamId: apid.StreamId
     * @param tag: string ファイル名に付くロールタグ (単一トラックなら空文字列)
     * @param entry: HLSMemoryStreamEntry
     * @return string | null
     */
    private getRecordedPlaylist(streamId: apid.StreamId, tag: string, entry: HLSMemoryStreamEntry): string | null {
        // ライブ (複数音声トラック分解モード) はライブウィンドウ分だけ、録画済みは保持している全セグメントを載せる
        const windowSegments =
            entry.mode === 'recorded' ? entry.segments : entry.segments.slice(-this.getPlaylistWindowNum(entry));
        if (windowSegments.length === 0) {
            return null;
        }

        let maxDuration = 0;
        for (const seg of windowSegments) {
            if (seg.duration > maxDuration) {
                maxDuration = seg.duration;
            }
        }
        const targetDuration = Math.max(1, Math.ceil(maxDuration));

        const lines: string[] = [
            '#EXTM3U',
            // #EXT-X-MAP (fMP4 の init 参照) に必要な最小バージョン
            '#EXT-X-VERSION:7',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            `#EXT-X-MEDIA-SEQUENCE:${windowSegments[0].seq}`,
            `#EXT-X-MAP:URI="stream${streamId}${tag}-init.mp4"`,
        ];

        if (entry.mode === 'recorded') {
            // 更新中プレイリストでも再生開始位置は録画の先頭に固定する
            // (無いと Safari / hls.js がライブプレイリストと解釈し、生成済みの末尾へ移動することがある)
            lines.push('#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
        }

        for (const seg of windowSegments) {
            lines.push(`#EXTINF:${seg.duration.toFixed(5)},`);
            lines.push(`stream${streamId}${tag}-${seg.seq}.m4s`);
        }

        if (entry.ended === true) {
            lines.push('#EXT-X-ENDLIST');
        }

        return lines.join('\n') + '\n';
    }

    public getMasterPlaylist(streamId: apid.StreamId, audioTracks: HLSMasterAudioTrack[]): string | null {
        if (this.has(streamId, 'v') === false) {
            return null;
        }

        const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];

        const groupId = 'aud';
        for (const track of audioTracks) {
            lines.push(
                `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${groupId}",NAME="${track.name}",` +
                    `DEFAULT=${track.isDefault === true ? 'YES' : 'NO'},AUTOSELECT=YES,` +
                    `URI="stream${streamId}${track.role}.m3u8"`,
            );
        }

        // **CODECS は必須**。書かないと Safari のネイティブ HLS が
        // 「映像レンディション + 別音声レンディション」を再生できない
        // (実測: WebKit 26 で audioTracks は 2 本見えるのに再生位置が進まない)。
        // 値は配信中の init セグメント (moov) から実際に読む
        const codecs = [
            this.getCodecString(streamId, 'v'),
            audioTracks.length > 0 ? this.getCodecString(streamId, audioTracks[0].role) : null,
        ].filter((codec): codec is string => codec !== null);
        const codecsAttr = codecs.length > 0 ? `,CODECS="${codecs.join(',')}"` : '';
        const audioAttr = audioTracks.length > 0 ? `,AUDIO="${groupId}"` : '';
        lines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${this.estimateBandwidth(streamId, audioTracks)}${codecsAttr},CLOSED-CAPTIONS=NONE${audioAttr}`,
        );
        lines.push(`stream${streamId}v.m3u8`);

        return lines.join('\n') + '\n';
    }

    /**
     * 指定ロールの init セグメントから CODECS 属性用の文字列を求める
     * @param streamId: apid.StreamId
     * @param role: HLSMemoryTrackRole
     * @return string | null init が未生成・未知のコーデックなら null
     */
    private getCodecString(streamId: apid.StreamId, role: HLSMemoryTrackRole): string | null {
        const init = this.getInitSegment(streamId, role);

        return init === null ? null : Mp4CodecUtil.parseCodec(init);
    }

    /**
     * マスタープレイリストの BANDWIDTH を配信済みセグメントの実測から見積もる
     * (単一レンディションしか無いので選択には使われないが、属性自体は必須)
     * @param streamId: apid.StreamId
     * @param audioTracks: HLSMasterAudioTrack[]
     * @return number bps
     */
    private estimateBandwidth(streamId: apid.StreamId, audioTracks: HLSMasterAudioTrack[]): number {
        const roles: HLSMemoryTrackRole[] = ['v', ...audioTracks.slice(0, 1).map(track => track.role)];
        let bps = 0;
        for (const role of roles) {
            const entry = this.entries.get(this.key(streamId, role));
            if (typeof entry === 'undefined') {
                continue;
            }

            const segments = entry.segments.filter(segment => segment.data !== null);
            const duration = segments.reduce((total, segment) => total + segment.duration, 0);
            const bytes = segments.reduce((total, segment) => total + (segment.data?.length ?? 0), 0);
            if (duration > 0) {
                bps += Math.round((bytes * 8) / duration);
            }
        }

        return bps > 0 ? bps : HLSMemoryStoreModel.DEFAULT_BANDWIDTH;
    }

    public waitForPlaylist(
        streamId: apid.StreamId,
        request: HLSPlaylistRequest,
        role?: HLSMemoryTrackRole,
    ): Promise<string | null> {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return Promise.resolve(null);
        }

        if (typeof request.msn !== 'number' || isNaN(request.msn) === true) {
            return Promise.resolve(this.getPlaylist(streamId, role));
        }

        // 古い msn に対して現在のプレイリストを返すと、要求した seq が消えたことを
        // プレイヤーが検知できず、現在の live edge へ飛ぶ原因になる
        if (this.isPlaylistRequestTooOld(streamId, request.msn, role) === true) {
            return Promise.resolve(null);
        }

        const partIndex = typeof request.part === 'number' && isNaN(request.part) === false ? request.part : 0;

        return this.waitForPart(entry, request.msn, partIndex).then(() => this.getPlaylist(streamId, role));
    }

    /**
     * ブロッキングプレイリスト要求の msn が保持範囲より古いか判定する
     * @param streamId: apid.StreamId
     * @param msn: number 要求されたメディアシーケンス番号
     * @param role?: HLSMemoryTrackRole
     * @return boolean 保持範囲より古い場合は true
     */
    public isPlaylistRequestTooOld(streamId: apid.StreamId, msn: number, role?: HLSMemoryTrackRole): boolean {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined' || Number.isFinite(msn) === false) {
            return false;
        }

        const oldestSeq =
            entry.segments.length > 0
                ? entry.segments[0].seq
                : entry.pending !== null
                  ? entry.pending.seq
                  : entry.nextSeq;

        return msn < oldestSeq;
    }

    public getInitSegment(streamId: apid.StreamId, role?: HLSMemoryTrackRole): Buffer | null {
        const entry = this.entries.get(this.key(streamId, role));

        return typeof entry === 'undefined' || entry.init === null ? null : entry.init;
    }

    public getSegment(streamId: apid.StreamId, seq: number, role?: HLSMemoryTrackRole): Buffer | null {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return null;
        }

        const segment = entry.segments.find(s => s.seq === seq);
        if (typeof segment !== 'undefined' && segment.data !== null) {
            this.markServedSeq(entry, seq);
        }

        return typeof segment === 'undefined' || segment.data === null ? null : segment.data;
    }

    public async getPart(
        streamId: apid.StreamId,
        seq: number,
        index: number,
        role?: HLSMemoryTrackRole,
    ): Promise<Buffer | null> {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined') {
            return null;
        }

        // 録画済み配信 (mode === 'recorded') はプレイリストに #EXT-X-PART / #EXT-X-PRELOAD-HINT を
        // 出さないため、通常はこの経路が呼ばれない。呼ばれた場合 (旧プレイリストを保持したままの
        // クライアント等) もデータ自体は返すが、lastServedSeq は進めない。
        // 進めてしまうと「ライブ端のパートを先取りする」プレイヤーの挙動 1 回分で
        // getAheadSegmentNum() が 0 近くまで跳び、エンコード抑制 (RecordedStreamBaseModel) が
        // 効かなくなる (実測、doc/streaming-refresh.md 参照)。録画の再生位置は getSegment() (セグメント単位の
        // 実際の取得) だけで追跡する
        const shouldMarkServed = entry.mode !== 'recorded';

        const found = this.findPart(entry, seq, index);
        if (found !== null) {
            if (shouldMarkServed === true) {
                this.markServedSeq(entry, seq);
            }
            return found;
        }

        await this.waitForPart(entry, seq, index);

        const served = this.findPart(entry, seq, index);
        if (served !== null && shouldMarkServed === true) {
            this.markServedSeq(entry, seq);
        }

        return served;
    }

    public getAheadSegmentNum(streamId: apid.StreamId, role?: HLSMemoryTrackRole): number {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined' || entry.lastServedSeq === null) {
            return 0;
        }

        // nextSeq は次に確定するセグメントの seq なので、確定済みの最新は nextSeq - 1
        return Math.max(0, entry.nextSeq - 1 - entry.lastServedSeq);
    }

    /**
     * クライアントが取得したセグメント seq を記録する
     * @param entry: HLSMemoryStreamEntry
     * @param seq: number
     */
    private markServedSeq(entry: HLSMemoryStreamEntry, seq: number): void {
        // ブラウザはバッファ補充中に古いセグメントも取得することがある。
        // それで先読み基準を後退させると、エンコード抑制が解除されてバーストする。
        if (entry.lastServedSeq === null || seq > entry.lastServedSeq) {
            entry.lastServedSeq = seq;
        }
        entry.servedSeqs.add(seq);
    }

    /**
     * エンコードが正常終了し、これ以上セグメントが増えないことを記録する。
     *
     * 録画済み in-memory HLS のエンコードは実時間より速く終わるため、エンコーダの終了を
     * そのままストリーム停止 (delete) に結びつけると、まだプレイヤーが取得していない
     * 末尾のセグメントが失われてしまう。この呼び出しではストア自体は破棄せず、
     * プレイリストへ #EXT-X-ENDLIST を付けて終端を伝えるだけに留める。
     * 待機中のブロッキング要求 (これ以上パートが増えないため自然には解決しない) はここで解決する。
     * ストアの破棄はクライアント切断や keep タイマー切れによる通常の delete() に任せる
     * @param streamId: apid.StreamId
     * @param role?: HLSMemoryTrackRole
     */
    public markEnded(streamId: apid.StreamId, role?: HLSMemoryTrackRole): void {
        const entry = this.entries.get(this.key(streamId, role));
        if (typeof entry === 'undefined' || entry.ended === true) {
            return;
        }

        entry.ended = true;
        this.log.stream.info(`mark in-memory HLS store ended: ${this.key(streamId, role)}`);

        for (const waiter of entry.waiters) {
            clearTimeout(waiter.timerId);
            waiter.resolve();
        }
        entry.waiters = [];
    }

    public delete(streamId: apid.StreamId, role?: HLSMemoryTrackRole): void {
        const key = this.key(streamId, role);
        const entry = this.entries.get(key);
        if (typeof entry === 'undefined') {
            return;
        }

        // 待機中の要求を残したまま破棄するとレスポンスが返らなくなる
        for (const waiter of entry.waiters) {
            clearTimeout(waiter.timerId);
            waiter.resolve();
        }
        entry.waiters = [];

        this.entries.delete(key);
        this.log.stream.info(`delete in-memory HLS store: ${key}`);
    }

    /**
     * 保持するセグメント数を返す (モードごとに異なる)。
     * 録画済みで再生位置 (lastServedSeq) が判明している間は trimOldSegments() が
     * RECORDED_KEEP_BEHIND_SEGMENT_NUM を優先して使うため、ここで返す値は
     * ライブ、または録画済みで再生位置がまだ判明していない間のフォールバックとして使われる
     * @param entry: HLSMemoryStreamEntry
     * @return number
     */
    private getRetainSegmentNum(entry: HLSMemoryStreamEntry): number {
        return entry.mode === 'recorded'
            ? HLSMemoryStoreModel.RECORDED_RETAIN_SEGMENT_NUM
            : HLSMemoryStoreModel.LIVE_RETAIN_SEGMENT_NUM;
    }

    /**
     * 保持上限を超えた古いセグメントを破棄する
     *
     * ライブは従来どおり件数 (LIVE_RETAIN_SEGMENT_NUM) を基準にする。
     * 録画済みは再生位置 (lastServedSeq) が判明していれば、そこから
     * RECORDED_KEEP_BEHIND_SEGMENT_NUM だけ遡った位置を基準にする (プレイヤーの先読みバッファより
     * 手前を破棄すると保持窓の先頭が再生位置を追い越し、ライブエッジへ強制シークされるため)。
     * 再生位置が未判明の間 (再生開始直後) は件数 (RECORDED_RETAIN_SEGMENT_NUM) で守る。
     *
     * どちらのモードでも、まだクライアントが取得していないセグメントは
     * 安全弁 (RECORDED_MAX_SEGMENT_NUM) を超えない限り削除しない
     * @param entry: HLSMemoryStreamEntry
     */
    private trimOldSegments(entry: HLSMemoryStreamEntry): void {
        for (;;) {
            if (entry.segments.length === 0) {
                return;
            }

            const oldest = entry.segments[0];
            const isSafetyOverride =
                entry.mode === 'recorded' && entry.segments.length > HLSMemoryStoreModel.RECORDED_MAX_SEGMENT_NUM;

            let shouldDiscard = isSafetyOverride;
            if (shouldDiscard === false) {
                if (entry.mode === 'recorded' && entry.lastServedSeq !== null) {
                    shouldDiscard =
                        oldest.seq < entry.lastServedSeq - HLSMemoryStoreModel.RECORDED_KEEP_BEHIND_SEGMENT_NUM;
                } else {
                    shouldDiscard = entry.segments.length > this.getRetainSegmentNum(entry);
                }
            }

            if (shouldDiscard === false) {
                return;
            }

            if (isSafetyOverride === false && entry.servedSeqs.has(oldest.seq) === false) {
                // プレイヤーがまだ取得していないセグメントは、保持上限だけを理由に削除しない
                return;
            }

            entry.servedSeqs.delete(oldest.seq);
            entry.segments.shift();
        }
    }

    /**
     * プレイリストに載せるセグメント数を返す
     * 録画済みは巻き戻しに応えるため保持しているものをすべて載せる
     * @param entry: HLSMemoryStreamEntry
     * @return number
     */
    private getPlaylistWindowNum(entry: HLSMemoryStreamEntry): number {
        return entry.mode === 'recorded' ? entry.segments.length : HLSMemoryStoreModel.LIVE_PLAYLIST_WINDOW_NUM;
    }

    /**
     * #EXT-X-PART 行を組み立てる
     * @param streamId: apid.StreamId
     * @param tag: string
     * @param seq: number
     * @param part: HLSMemoryPart
     * @return string
     */
    private buildPartLine(streamId: apid.StreamId, tag: string, seq: number, part: HLSMemoryPart): string {
        const independent = part.isIndependent === true ? ',INDEPENDENT=YES' : '';

        return (
            `#EXT-X-PART:DURATION=${part.duration.toFixed(5)},` +
            `URI="${this.buildPartFileName(streamId, tag, seq, part.index)}"${independent}`
        );
    }

    /**
     * パートのファイル名を組み立てる (セグメントの .m4s と衝突しない形にする)
     * @param streamId: apid.StreamId
     * @param tag: string
     * @param seq: number
     * @param index: number
     * @return string
     */
    private buildPartFileName(streamId: apid.StreamId, tag: string, seq: number, index: number): string {
        return `stream${streamId}${tag}-${seq}.${index}.part.m4s`;
    }

    /**
     * 保持中のパートを探す (確定済みセグメント・組み立て中セグメントの両方を見る)
     * @param entry: HLSMemoryStreamEntry
     * @param seq: number
     * @param index: number
     * @return Buffer | null
     */
    private findPart(entry: HLSMemoryStreamEntry, seq: number, index: number): Buffer | null {
        const segment =
            entry.pending !== null && entry.pending.seq === seq
                ? entry.pending
                : entry.segments.find(s => s.seq === seq);
        if (typeof segment === 'undefined') {
            return null;
        }

        const part = segment.parts[index];

        return typeof part === 'undefined' ? null : part.data;
    }

    /**
     * 指定パートが生成されるまで待つ (生成済み・保持範囲外・上限超過の場合は即座に解決する)
     * @param entry: HLSMemoryStreamEntry
     * @param seq: number
     * @param index: number
     * @return Promise<void>
     */
    private waitForPart(entry: HLSMemoryStreamEntry, seq: number, index: number): Promise<void> {
        if (this.isPartAvailable(entry, seq, index) === true) {
            return Promise.resolve();
        }

        // 遠すぎる未来を要求された場合は待たずに現状を返す (不正な要求で接続を溜め込まないため)
        if (seq > entry.nextSeq + HLSMemoryStoreModel.MAX_LOOKAHEAD_SEGMENT_NUM) {
            return Promise.resolve();
        }

        return new Promise<void>(resolve => {
            const waiter: HLSMemoryWaiter = {
                seq: seq,
                index: index,
                resolve: resolve,
                timerId: setTimeout(() => {
                    entry.waiters = entry.waiters.filter(w => w !== waiter);
                    resolve();
                }, HLSMemoryStoreModel.BLOCK_TIMEOUT),
            };
            entry.waiters.push(waiter);
        });
    }

    /**
     * 指定パートが取得可能か (生成済み、または破棄済みで待っても現れないか) を判定する
     * @param entry: HLSMemoryStreamEntry
     * @param seq: number
     * @param index: number
     * @return boolean
     */
    private isPartAvailable(entry: HLSMemoryStreamEntry, seq: number, index: number): boolean {
        if (this.findPart(entry, seq, index) !== null) {
            return true;
        }

        // 既に破棄された、または確定済みでこれ以上パートが増えないセグメントは待っても現れない
        const oldestSeq = entry.segments.length === 0 ? entry.nextSeq : entry.segments[0].seq;
        if (seq < oldestSeq) {
            return true;
        }

        // エンコードが正常終了済みなら、これ以上パート・セグメントが増えることはない
        // (markEnded() 以降 addPart/addSegment は呼ばれない前提)。待っても永遠に来ないので確定扱いにする
        if (entry.ended === true) {
            return true;
        }

        const segment = entry.segments.find(s => s.seq === seq);

        return typeof segment !== 'undefined' && segment.complete === true;
    }

    /**
     * パート生成・セグメント確定を待っている要求を解決する
     * @param entry: HLSMemoryStreamEntry
     * @param seq: number 生成されたパートのセグメント番号
     * @param index: number 生成されたパート番号
     */
    private resolveWaiters(entry: HLSMemoryStreamEntry, seq: number, index: number): void {
        if (entry.waiters.length === 0) {
            return;
        }

        const remain: HLSMemoryWaiter[] = [];
        for (const waiter of entry.waiters) {
            // 要求された位置に到達した (= その位置以降のパートが生成された) 待機者を解決する
            if (seq > waiter.seq || (seq === waiter.seq && index >= waiter.index)) {
                clearTimeout(waiter.timerId);
                waiter.resolve();
            } else {
                remain.push(waiter);
            }
        }
        entry.waiters = remain;
    }
}
