import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IHLSMemoryStoreModel, { HLSMemorySegment } from './IHLSMemoryStoreModel';

interface HLSMemoryStreamEntry {
    init: Buffer | null;
    segments: HLSMemorySegment[];
    nextSeq: number;
}

/**
 * ライブ HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * tmpfs など OS 依存の仕組みを使わないため Windows でも動作する
 */
@injectable()
export default class HLSMemoryStoreModel implements IHLSMemoryStoreModel {
    // プレイリストに載せるセグメント数 (ライブウィンドウ)
    // セグメントは約 0.5 秒なので、8 本で約 4 秒分のウィンドウになる
    private static readonly PLAYLIST_WINDOW_NUM = 8;
    // メモリ上に保持するセグメント数 (取得が遅れたプレイヤー向けにウィンドウより多めに残す)
    private static readonly RETAIN_SEGMENT_NUM = 16;
    // 再生開始可能と判定する最低セグメント数
    // 少ないほど再生開始が早い。1 本ではプレイヤーがライブエッジに張り付けないため 2 本を最低とする
    private static readonly READY_SEGMENT_NUM = 2;

    private log: ILogger;
    private entries: Map<apid.StreamId, HLSMemoryStreamEntry> = new Map();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    public create(streamId: apid.StreamId): void {
        this.log.stream.info(`create in-memory HLS store: ${streamId}`);
        this.entries.set(streamId, {
            init: null,
            segments: [],
            nextSeq: 0,
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

    public addSegment(streamId: apid.StreamId, data: Buffer, duration: number): void {
        const entry = this.entries.get(streamId);
        if (typeof entry === 'undefined') {
            return;
        }

        entry.segments.push({
            seq: entry.nextSeq,
            data: data,
            duration: duration,
        });
        entry.nextSeq += 1;

        // 保持上限を超えた古いセグメントは破棄する
        while (entry.segments.length > HLSMemoryStoreModel.RETAIN_SEGMENT_NUM) {
            entry.segments.shift();
        }
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

        // 直近 PLAYLIST_WINDOW_NUM 個のセグメントだけをプレイリストに載せる (スライディングウィンドウ)
        const windowSegments = entry.segments.slice(-HLSMemoryStoreModel.PLAYLIST_WINDOW_NUM);

        // TARGETDURATION はプレイリスト内の最大継続時間の切り上げ (最低 1)
        let maxDuration = 0;
        for (const seg of windowSegments) {
            if (seg.duration > maxDuration) {
                maxDuration = seg.duration;
            }
        }
        const targetDuration = Math.max(1, Math.ceil(maxDuration));

        const lines: string[] = [
            '#EXTM3U',
            '#EXT-X-VERSION:6',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            `#EXT-X-MEDIA-SEQUENCE:${windowSegments[0].seq}`,
            `#EXT-X-MAP:URI="stream${streamId}-init.mp4"`,
        ];

        for (const seg of windowSegments) {
            lines.push(`#EXTINF:${seg.duration.toFixed(5)},`);
            lines.push(`stream${streamId}-${seg.seq}.m4s`);
        }

        return lines.join('\n') + '\n';
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

        return typeof segment === 'undefined' ? null : segment.data;
    }

    public delete(streamId: apid.StreamId): void {
        if (this.entries.delete(streamId) === true) {
            this.log.stream.info(`delete in-memory HLS store: ${streamId}`);
        }
    }
}
