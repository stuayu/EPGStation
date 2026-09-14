import * as apid from '../../../api';
import OfflineVideoStorage, { OfflineVideoRecord } from './OfflineVideoStorage';
import OfflineStreamParser from '../../../src/util/OfflineStreamParser';
import Util from '@/util/Util';
import { withMediaToken } from '@/util/MediaToken';

export interface OfflineDownloadJob {
    videoId: number;
    profile: string;
    downloadedBytes: number;
    state: 'Downloading' | 'Completed' | 'Failed';
    error: string | null;
}

interface OfflineLockManager {
    request<T>(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<T>): Promise<T>;
}

/** Cache Storage / IndexedDB を使う録画番組オフライン保存サービス。 */
export default class OfflineVideos {
    public static readonly eventTarget = new EventTarget();
    private static readonly CACHE_NAME = 'epgstation-offline-videos';
    private static readonly jobs = new Map<number, OfflineDownloadJob>();

    public static async getVideos(): Promise<OfflineVideoRecord[]> { return await OfflineVideoStorage.getAll(); }
    public static getJob(videoId: number): OfflineDownloadJob | null { return this.jobs.get(videoId) ?? null; }
    public static getPlaylistURL(video: OfflineVideoRecord): string { return video.playlistURL; }

    /** 録画番組を指定した録画 HLS プロファイルで保存する。 */
    public static async start(program: apid.RecordedItem, videoFileId: apid.VideoFileId, profile: string, videoBitrateKbps?: number): Promise<OfflineVideoRecord> {
        const lockManager = (navigator as Navigator & { locks?: OfflineLockManager }).locks;
        if (lockManager === undefined) return await this.startUnlocked(program, videoFileId, profile, videoBitrateKbps);
        return await lockManager.request(`epgstation-offline-${videoFileId}`, { ifAvailable: true }, async lock => {
            if (lock === null) throw new Error('この録画番組はすでにオフライン保存中です。');
            return await this.startUnlocked(program, videoFileId, profile, videoBitrateKbps);
        });
    }

    private static async startUnlocked(program: apid.RecordedItem, videoFileId: apid.VideoFileId, profile: string, videoBitrateKbps?: number): Promise<OfflineVideoRecord> {
        if (this.jobs.has(videoFileId)) throw new Error('この録画番組はすでにオフライン保存中です。');
        const snapshot = JSON.parse(JSON.stringify(program)) as apid.RecordedItem;
        const duration = snapshot.videoFiles?.find(item => item.id === videoFileId)?.duration ?? 0;
        const mediaBitrateBytesPerSecond = ((videoBitrateKbps ?? 3000) * 1000 + 192000) / 8;
        const estimatedBytes = Math.max(16 * 1024 * 1024, Math.ceil(duration * mediaBitrateBytesPerSecond * 1.15));
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < estimatedBytes) throw new Error('オフライン保存に必要な空き容量が不足しています。');
        await navigator.storage?.persist?.();

        const job: OfflineDownloadJob = { videoId: videoFileId, profile, downloadedBytes: 0, state: 'Downloading', error: null };
        this.jobs.set(videoFileId, job);
        this.eventTarget.dispatchEvent(new Event('change'));
        const generationId = crypto.randomUUID();
        const basePath = `${Util.getSubDirectory()}/local/offline/${videoFileId}/${generationId}`;
        const baseURL = new URL(`${basePath}/`, location.href).toString();
        const cache = await caches.open(this.CACHE_NAME);
        const thumbnailURLs: string[] = [];
        const url = withMediaToken(`${Util.getSubDirectory()}/api/videos/${videoFileId}/offline?profile=${encodeURIComponent(profile)}&audioTrack=all`);
        try {
            for (const thumbnailId of snapshot.thumbnails ?? []) {
                const thumbnailURL = new URL(`thumbnails/${thumbnailId}`, baseURL).toString();
                try {
                    const thumbnailResponse = await fetch(withMediaToken(`${Util.getSubDirectory()}/api/thumbnails/${thumbnailId}`), { credentials: 'include', cache: 'no-store' });
                    if (thumbnailResponse.ok) {
                        await cache.put(thumbnailURL, thumbnailResponse.clone());
                        thumbnailURLs.push(thumbnailURL);
                    }
                } catch {
                    // サムネイル取得失敗は動画保存を失敗させない。
                }
            }
            const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
            if (!response.ok || response.body === null) throw new Error(`オフライン保存 API が失敗しました (${response.status})`);
            const reader = response.body.getReader();
            const parser = new OfflineStreamParser();
            const durations = new Map<string, number[]>();
            let metadata: { videoFileId: number; fileSize: number; duration: number; profile: string; formatVersion: 2 } | null = null;
            let masterPlaylist: string | null = null;
            let sizeBytes = 0;
            let done = false;
            while (done === false) {
                const result = await reader.read();
                done = result.done;
                if (result.value === undefined) continue;
                for (const event of parser.push(result.value)) {
                    if (event.type === 'metadata') {
                        metadata = event.metadata;
                        if (metadata.videoFileId !== videoFileId || metadata.profile !== profile) throw new Error('保存メタデータが一致しません。');
                    } else if (event.type === 'init') {
                        const role = event.init.role === 'single' ? 'video' : event.init.role;
                        const initBody = event.init.data.slice().buffer as ArrayBuffer;
                        await cache.put(new URL(`${role}-init.mp4`, baseURL), new Response(initBody, { headers: { 'Content-Type': 'video/mp4' } }));
                    } else if (event.type === 'master') {
                        // 単一トラックのサーバー role は `single` だが、ローカルでは video
                        // という URL に統一する。複数音声の role 名はそのまま使う。
                        masterPlaylist = new TextDecoder().decode(event.data).replace(/\bsingle\.m3u8\b/gu, 'video.m3u8');
                        await cache.put(new URL('playlist.m3u8', baseURL), new Response(masterPlaylist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }));
                    } else if (event.type === 'segment') {
                        sizeBytes += event.segment.data.byteLength;
                        job.downloadedBytes = sizeBytes;
                        const role = event.segment.role === 'single' ? 'video' : event.segment.role;
                        const roleDurations = durations.get(role) ?? [];
                        roleDurations[event.segment.sequence] = event.segment.duration;
                        durations.set(role, roleDurations);
                        const segmentBody = event.segment.data.slice().buffer as ArrayBuffer;
                        await cache.put(new URL(`segments/${role}/${event.segment.sequence}.m4s`, baseURL), new Response(segmentBody, { headers: { 'Content-Type': 'video/iso.segment' } }));
                        this.eventTarget.dispatchEvent(new Event('change'));
                    }
                }
            }
            parser.finish();
            if (metadata === null || masterPlaylist === null || durations.size === 0) throw new Error('オフライン保存データが空です。');
            for (const [role, roleDurations] of durations) {
                if (roleDurations.length === 0 || roleDurations.some(value => value <= 0)) throw new Error('オフライン保存データのセグメントが欠落しています。');
                const targetDuration = Math.max(1, Math.ceil(Math.max(...roleDurations)));
                let playlist = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-PLAYLIST-TYPE:VOD\n';
                playlist += `#EXT-X-TARGETDURATION:${targetDuration}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="${role}-init.mp4"\n`;
                roleDurations.forEach((value, sequence) => { playlist += `#EXTINF:${value.toFixed(3)},\nsegments/${role}/${sequence}.m4s\n`; });
                playlist += '#EXT-X-ENDLIST\n';
                await cache.put(new URL(`${role}.m3u8`, baseURL), new Response(playlist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }));
            }
            const video: OfflineVideoRecord = {
                videoId: videoFileId,
                generationId,
                program: snapshot,
                profile,
                sizeBytes,
                segmentCount: durations.get('video')?.length ?? 0,
                savedAt: Date.now(),
                playlistURL: new URL('playlist.m3u8', baseURL).toString(),
                thumbnailURLs,
            };
            await OfflineVideoStorage.put(video);
            job.state = 'Completed';
            this.jobs.delete(videoFileId);
            this.eventTarget.dispatchEvent(new Event('change'));
            return video;
        } catch (err) {
            job.state = 'Failed';
            job.error = err instanceof Error ? err.message : String(err);
            this.eventTarget.dispatchEvent(new Event('change'));
            const keys = await cache.keys();
            await Promise.all(keys.filter(key => key.url.startsWith(baseURL)).map(key => cache.delete(key)));
            throw err;
        } finally {
            this.jobs.delete(videoFileId);
            this.eventTarget.dispatchEvent(new Event('change'));
        }
    }

    public static async delete(video: OfflineVideoRecord): Promise<void> {
        await OfflineVideoStorage.delete(video);
        this.eventTarget.dispatchEvent(new Event('change'));
    }
}
