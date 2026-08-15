import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IHLSMemoryStoreModel, {
    HLSMemoryPart,
    HLSMemorySegment,
    HLSMemoryStoreMode,
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
}

/**
 * ライブ / 録画済み HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * tmpfs など OS 依存の仕組みを使わないため Windows でも動作する
 *
 * LL-HLS (RFC 8216bis) に対応しており、セグメントが確定する前でも
 * パート (#EXT-X-PART) をプレイリストへ載せて配信する。
 * ブロッキングプレイリスト要求 (_HLS_msn / _HLS_part) と
 * #EXT-X-PRELOAD-HINT で先行要求されたパートの待機にも応える
 */
@injectable()
export default class HLSMemoryStoreModel implements IHLSMemoryStoreModel {
    // プレイリストに載せるセグメント数 (ライブウィンドウ)
    // セグメントは約 1 秒なので、6 本で約 6 秒分のウィンドウになる
    private static readonly LIVE_PLAYLIST_WINDOW_NUM = 6;
    // メモリ上に保持するセグメント数 (取得が遅れたプレイヤー向けにウィンドウより多めに残す)
    private static readonly LIVE_RETAIN_SEGMENT_NUM = 12;
    // 録画済み配信で保持・掲載するセグメント数
    // 録画済みは巻き戻し操作に応えたいのでライブより長く持つ (1 秒セグメント換算で約 3 分)
    private static readonly RECORDED_RETAIN_SEGMENT_NUM = 180;
    // 再生開始可能と判定する最低セグメント数
    // 少ないほど再生開始が早い。1 本ではプレイヤーがライブエッジに張り付けないため 2 本を最低とする
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
    private entries: Map<apid.StreamId, HLSMemoryStreamEntry> = new Map();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    public create(streamId: apid.StreamId, mode: HLSMemoryStoreMode = 'live'): void {
        this.log.stream.info(`create in-memory HLS store: ${streamId} (${mode})`);
        this.entries.set(streamId, {
            mode: mode,
            init: null,
            segments: [],
            nextSeq: 0,
            pending: null,
            waiters: [],
        });
    }

    public has(streamId: apid.StreamId): boolean {
        return this.entries.has(streamId);
    }

    public setInit(streamId: apid.StreamId, data: Buffer): void {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return;
        }

        entry.init = data;
    }

    public addPart(streamId: apid.StreamId, data: Buffer, duration: number, isIndependent: boolean): void {
        const entry = this.entries.get(streamId);
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

    public addSegment(streamId: apid.StreamId, data: Buffer, duration: number): void {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return;
        }

        // addPart を経由していない場合 (パート非対応の呼び出し) はセグメント全体を 1 パートとして扱う
        if (entry.pending === null) {
            this.addPart(streamId, data, duration, true);
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

        // 保持上限を超えた古いセグメントは破棄する
        const retainNum = this.getRetainSegmentNum(entry);
        while (entry.segments.length > retainNum) {
            entry.segments.shift();
        }

        // セグメント確定もプレイリスト更新なので、待機中の要求を解決する
        this.resolveWaiters(entry, segment.seq, segment.parts.length - 1);
    }

    public isReady(streamId: apid.StreamId): boolean {
        const entry = this.entries.get(streamId);

        return (
            typeof entry !== 'undefined' &&
            entry.init !== null &&
            entry.segments.length >= HLSMemoryStoreModel.READY_SEGMENT_NUM
        );
    }

    public getPlaylist(streamId: apid.StreamId): string | null {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined' || entry.init === null || entry.segments.length === 0) {
            return null;
        }

        const windowSegments = entry.segments.slice(-this.getPlaylistWindowNum(entry));

        // TARGETDURATION はプレイリスト内の最大継続時間の切り上げ (最低 1)
        let maxDuration = 0;
        let maxPartDuration = 0;
        for (const seg of windowSegments) {
            if (seg.duration > maxDuration) {
                maxDuration = seg.duration;
            }
            for (const part of seg.parts) {
                if (part.duration > maxPartDuration) {
                    maxPartDuration = part.duration;
                }
            }
        }
        for (const part of entry.pending?.parts ?? []) {
            if (part.duration > maxPartDuration) {
                maxPartDuration = part.duration;
            }
        }
        const targetDuration = Math.max(1, Math.ceil(maxDuration));
        // PART-TARGET は実際のパート長以上でなければならない。小数第 3 位まで切り上げる
        const partTarget = Math.max(0.001, Math.ceil(maxPartDuration * 1000) / 1000);
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
            `#EXT-X-MAP:URI="stream${streamId}-init.mp4"`,
        ];

        // #EXT-X-PART を載せる範囲 (プレイリスト末尾から PART_WINDOW_SEGMENT_NUM 分)
        const partWindowStartSeq =
            windowSegments[windowSegments.length - 1].seq - (HLSMemoryStoreModel.PART_WINDOW_SEGMENT_NUM - 1);

        for (const seg of windowSegments) {
            if (seg.seq >= partWindowStartSeq) {
                for (const part of seg.parts) {
                    lines.push(this.buildPartLine(streamId, seg.seq, part));
                }
            }
            lines.push(`#EXTINF:${seg.duration.toFixed(5)},`);
            lines.push(`stream${streamId}-${seg.seq}.m4s`);
        }

        // 組み立て中セグメントのパート (セグメント確定を待たずに再生できるようにする)
        const pending = entry.pending;
        const nextSeq = pending === null ? entry.nextSeq : pending.seq;
        const nextPartIndex = pending === null ? 0 : pending.parts.length;
        if (pending !== null) {
            for (const part of pending.parts) {
                lines.push(this.buildPartLine(streamId, pending.seq, part));
            }
        }

        // 次に生成されるパートを先行要求させる (プレイヤーはこの URI へ即座に接続して待機する)
        lines.push(`#EXT-X-PRELOAD-HINT:TYPE=PART,URI="${this.buildPartFileName(streamId, nextSeq, nextPartIndex)}"`);

        return lines.join('\n') + '\n';
    }

    public waitForPlaylist(streamId: apid.StreamId, request: HLSPlaylistRequest): Promise<string | null> {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return Promise.resolve(null);
        }

        if (typeof request.msn !== 'number' || isNaN(request.msn) === true) {
            return Promise.resolve(this.getPlaylist(streamId));
        }

        const partIndex = typeof request.part === 'number' && isNaN(request.part) === false ? request.part : 0;

        return this.waitForPart(entry, request.msn, partIndex).then(() => this.getPlaylist(streamId));
    }

    public getInitSegment(streamId: apid.StreamId): Buffer | null {
        const entry = this.entries.get(streamId);

        return typeof entry === 'undefined' || entry.init === null ? null : entry.init;
    }

    public getSegment(streamId: apid.StreamId, seq: number): Buffer | null {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return null;
        }

        const segment = entry.segments.find(s => s.seq === seq);

        return typeof segment === 'undefined' || segment.data === null ? null : segment.data;
    }

    public async getPart(streamId: apid.StreamId, seq: number, index: number): Promise<Buffer | null> {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return null;
        }

        const found = this.findPart(entry, seq, index);
        if (found !== null) {
            return found;
        }

        await this.waitForPart(entry, seq, index);

        return this.findPart(entry, seq, index);
    }

    public delete(streamId: apid.StreamId): void {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return;
        }

        // 待機中の要求を残したまま破棄するとレスポンスが返らなくなる
        for (const waiter of entry.waiters) {
            clearTimeout(waiter.timerId);
            waiter.resolve();
        }
        entry.waiters = [];

        this.entries.delete(streamId);
        this.log.stream.info(`delete in-memory HLS store: ${streamId}`);
    }

    /**
     * 保持するセグメント数を返す (モードごとに異なる)
     * @param entry: HLSMemoryStreamEntry
     * @return number
     */
    private getRetainSegmentNum(entry: HLSMemoryStreamEntry): number {
        return entry.mode === 'recorded'
            ? HLSMemoryStoreModel.RECORDED_RETAIN_SEGMENT_NUM
            : HLSMemoryStoreModel.LIVE_RETAIN_SEGMENT_NUM;
    }

    /**
     * プレイリストに載せるセグメント数を返す
     * 録画済みは巻き戻しに応えるため保持しているものをすべて載せる
     * @param entry: HLSMemoryStreamEntry
     * @return number
     */
    private getPlaylistWindowNum(entry: HLSMemoryStreamEntry): number {
        return entry.mode === 'recorded'
            ? HLSMemoryStoreModel.RECORDED_RETAIN_SEGMENT_NUM
            : HLSMemoryStoreModel.LIVE_PLAYLIST_WINDOW_NUM;
    }

    /**
     * #EXT-X-PART 行を組み立てる
     * @param streamId: apid.StreamId
     * @param seq: number
     * @param part: HLSMemoryPart
     * @return string
     */
    private buildPartLine(streamId: apid.StreamId, seq: number, part: HLSMemoryPart): string {
        const independent = part.isIndependent === true ? ',INDEPENDENT=YES' : '';

        return (
            `#EXT-X-PART:DURATION=${part.duration.toFixed(5)},` +
            `URI="${this.buildPartFileName(streamId, seq, part.index)}"${independent}`
        );
    }

    /**
     * パートのファイル名を組み立てる (セグメントの .m4s と衝突しない形にする)
     * @param streamId: apid.StreamId
     * @param seq: number
     * @param index: number
     * @return string
     */
    private buildPartFileName(streamId: apid.StreamId, seq: number, index: number): string {
        return `stream${streamId}-${seq}.${index}.part.m4s`;
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
