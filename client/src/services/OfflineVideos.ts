import * as apid from '../../../api';
import OfflineVideoStorage, { OfflineVideoRecord } from './OfflineVideoStorage';
import OfflineStreamParser from '../../../src/util/OfflineStreamParser';
import {
    createOfflineProgramInfo,
    createOfflineVideoKey,
    findOfflineVideoByIds,
    normalizeOfflineChapters,
    ORIGINAL_MPEG2_CHUNK_SIZE,
    splitOfflineMpeg2Ranges,
} from '../../../src/util/OfflineUxUtil';
import Util from '@/util/Util';
import { withMediaToken } from '@/util/MediaToken';
import GenreUtil from '@/util/GenreUtil';
import container from '@/model/ModelContainer';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import { resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
import type { OfflineJikkyoParam } from '../../../src/util/OfflineJikkyoParam';

export interface OfflineDownloadJob {
    videoId: number;
    profile: string;
    profileLabel?: string;
    downloadedBytes: number;
    estimatedBytes: number;
    program: apid.RecordedItem;
    programInfo: ReturnType<typeof createOfflineProgramInfo>;
    state: 'Downloading' | 'Completed' | 'Failed';
    error: string | null;
}

interface OfflineLockManager {
    request<T>(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<T>): Promise<T>;
}

export interface OfflineVideoInfoOptions {
    channelName?: string;
    displayName?: string;
    /** 画面に出す保存画質名 (例: データ節約)。profile は内部 id なので表示に使わない */
    profileLabel?: string;
}

/** Cache Storage / IndexedDB を使う録画番組オフライン保存サービス。 */
export default class OfflineVideos {
    public static readonly eventTarget = new EventTarget();
    private static readonly CACHE_NAME = 'epgstation-offline-videos';
    private static readonly jobs = new Map<number, OfflineDownloadJob>();
    private static savedVideoIndex: OfflineVideoRecord[] | null = null;
    private static savedVideoIndexPromise: Promise<OfflineVideoRecord[]> | null = null;

    private static getJikkyoResolveModels(): { recordedApiModel: IRecordedApiModel; channelModel: IChannelModel; videoApiModel: IVideoApiModel } {
        return {
            recordedApiModel: container.get<IRecordedApiModel>('IRecordedApiModel'),
            channelModel: container.get<IChannelModel>('IChannelModel'),
            videoApiModel: container.get<IVideoApiModel>('IVideoApiModel'),
        };
    }

    public static async getVideos(): Promise<OfflineVideoRecord[]> {
        if (this.savedVideoIndex !== null) return this.savedVideoIndex;
        if (this.savedVideoIndexPromise === null) {
            this.savedVideoIndexPromise = OfflineVideoStorage.getAll().then(videos => {
                this.savedVideoIndex = videos;
                this.savedVideoIndexPromise = null;
                return videos;
            }).catch(error => {
                this.savedVideoIndexPromise = null;
                throw error;
            });
        }
        return await this.savedVideoIndexPromise;
    }
    public static async getSavedVideo(videoIds: number[]): Promise<OfflineVideoRecord | null> {
        return findOfflineVideoByIds(await this.getVideos(), videoIds);
    }
    public static async getSavedVideos(videoIds: number[]): Promise<OfflineVideoRecord[]> {
        const ids = new Set(videoIds);
        return (await this.getVideos()).filter(video => ids.has(video.videoId));
    }
    public static getJob(videoId: number): OfflineDownloadJob | null { return this.jobs.get(videoId) ?? null; }
    public static getJobs(): OfflineDownloadJob[] { return [...this.jobs.values()]; }
    public static getPlaylistURL(video: OfflineVideoRecord): string { return video.playlistURL; }

    /** 録画番組を指定した録画 HLS プロファイルで保存する。 */
    public static async start(
        program: apid.RecordedItem,
        videoFileId: apid.VideoFileId,
        profile: string,
        videoBitrateKbps?: number,
        infoOptions: OfflineVideoInfoOptions = {},
    ): Promise<OfflineVideoRecord> {
        const lockManager = (navigator as Navigator & { locks?: OfflineLockManager }).locks;
        if (lockManager === undefined) return await this.startUnlocked(program, videoFileId, profile, videoBitrateKbps, infoOptions);
        return await lockManager.request(`epgstation-offline-${videoFileId}`, { ifAvailable: true }, async lock => {
            if (lock === null) throw new Error('この録画番組はすでにオフライン保存中です。');
            return await this.startUnlocked(program, videoFileId, profile, videoBitrateKbps, infoOptions);
        });
    }

    private static async startUnlocked(
        program: apid.RecordedItem,
        videoFileId: apid.VideoFileId,
        profile: string,
        videoBitrateKbps?: number,
        infoOptions: OfflineVideoInfoOptions = {},
    ): Promise<OfflineVideoRecord> {
        if (this.jobs.has(videoFileId)) throw new Error('この録画番組はすでにオフライン保存中です。');
        const snapshot = JSON.parse(JSON.stringify(program)) as apid.RecordedItem;
        const sourceVideo = snapshot.videoFiles?.find(item => item.id === videoFileId);
        if (sourceVideo === undefined) throw new Error('保存対象の録画ファイルが見つかりません。');
        const isOriginalMpeg2 = profile === 'original-mpeg2';
        const duration = sourceVideo.duration ?? 0;
        const mediaBitrateBytesPerSecond = ((videoBitrateKbps ?? 3000) * 1000 + 192000) / 8;
        const estimatedBytes = isOriginalMpeg2 === true ? sourceVideo.size : Math.max(16 * 1024 * 1024, Math.ceil(duration * mediaBitrateBytesPerSecond * 1.15));
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota !== undefined && estimate.quota - (estimate.usage ?? 0) < estimatedBytes) throw new Error('オフライン保存に必要な空き容量が不足しています。');
        await navigator.storage?.persist?.();

        const generationId = crypto.randomUUID();
        const key = createOfflineVideoKey(videoFileId, generationId);
        const programInfo = createOfflineProgramInfo(snapshot, {
            videoFileId,
            channelName: infoOptions.channelName,
            displayName: infoOptions.displayName,
            resolveGenre: (genre, subGenre) => GenreUtil.getGenres(genre, subGenre),
        });
        // 実況パラメータは保存開始時のオンライン状態で一度だけ解決する。
        // 外部 API / 局対応表の失敗は動画保存を失敗させない。
        let jikkyoParam: OfflineJikkyoParam | null = null;
        try {
            const models = this.getJikkyoResolveModels();
            jikkyoParam = await resolveJikkyoKakologParam({
                ...models,
                recordedId: snapshot.id,
                videoFileId,
            });
        } catch (error) {
            console.error('offline jikkyo parameter resolve error', error);
        }
        // チャプターは DPlayer 生成前に必要なため、保存レコードへスナップショットする。
        // 取得できない録画や旧 API でも動画保存自体は継続する。
        let chapters: apid.VideoChapter[] = [];
        try {
            chapters = normalizeOfflineChapters(await this.getJikkyoResolveModels().videoApiModel.getChapters(videoFileId));
        } catch (error) {
            console.error('offline chapter resolve error', error);
        }
        const job: OfflineDownloadJob = { videoId: videoFileId, profile, profileLabel: infoOptions.profileLabel, downloadedBytes: 0, estimatedBytes, program: snapshot, programInfo, state: 'Downloading', error: null };
        this.jobs.set(videoFileId, job);
        this.eventTarget.dispatchEvent(new Event('change'));
        const basePath = `${Util.getSubDirectory()}/local/offline/${videoFileId}/${generationId}`;
        const baseURL = new URL(`${basePath}/`, location.href).toString();
        const cache = await caches.open(this.CACHE_NAME);
        const thumbnailURLs: string[] = [];
        const channelLogoURL = new URL('channel-logo', baseURL).toString();
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
            if (typeof snapshot.channelId === 'number') {
                try {
                    const logoResponse = await fetch(withMediaToken(`${Util.getSubDirectory()}/api/channels/${snapshot.channelId.toString(10)}/logo`), {
                        credentials: 'include',
                        cache: 'no-store',
                    });
                    if (logoResponse.ok) await cache.put(channelLogoURL, logoResponse.clone());
                } catch {
                    // 放送局ロゴは補助情報。取得失敗で動画保存を失敗させない。
                }
            }
            if (isOriginalMpeg2 === true) {
                const ranges = splitOfflineMpeg2Ranges(sourceVideo.size, ORIGINAL_MPEG2_CHUNK_SIZE);
                if (ranges.length === 0) throw new Error('録画ファイルサイズが不正です。');
                const originalURL = new URL('original.ts', baseURL).toString();
                const chunkManifest = { fileSize: sourceVideo.size, chunkSize: ORIGINAL_MPEG2_CHUNK_SIZE, chunks: ranges };
                await cache.put(new URL('original.ts.manifest', baseURL), new Response(JSON.stringify(chunkManifest), { headers: { 'Content-Type': 'application/json' } }));
                for (const range of ranges) {
                    const response = await fetch(withMediaToken(`${Util.getSubDirectory()}/api/videos/${videoFileId}/original`), {
                        credentials: 'include',
                        cache: 'no-store',
                        headers: { Range: `bytes=${range.start}-${range.end}` },
                    });
                    if (!response.ok || response.status !== 206 || response.body === null) throw new Error(`オリジナル保存 API が失敗しました (${response.status})`);
                    const data = await response.arrayBuffer();
                    if (data.byteLength !== range.end - range.start + 1) throw new Error('オリジナル保存チャンクのサイズが一致しません。');
                    job.downloadedBytes += data.byteLength;
                    await cache.put(new URL(`original.ts/chunks/${range.start}`, baseURL), new Response(data, { headers: { 'Content-Type': 'video/mp2t' } }));
                    this.eventTarget.dispatchEvent(new Event('change'));
                }
                const offlineVideo: OfflineVideoRecord = {
                    key,
                    videoId: videoFileId,
                    generationId,
                    program: snapshot,
                    kind: 'original-mpeg2',
                    profile,
                    profileLabel: infoOptions.profileLabel,
                    sizeBytes: sourceVideo.size,
                    segmentCount: 0,
                    savedAt: Date.now(),
                    playlistURL: originalURL,
                    originalURL,
                    originalFileSize: sourceVideo.size,
                    originalChunkSize: ORIGINAL_MPEG2_CHUNK_SIZE,
                    durationSeconds: duration,
                    chapters: chapters.length > 0 ? chapters : undefined,
                    thumbnailURLs,
                    channelLogoURL: (await cache.match(channelLogoURL)) === undefined ? undefined : channelLogoURL,
                    programInfo,
                    ...jikkyoParam,
                };
                await OfflineVideoStorage.put(offlineVideo);
                this.savedVideoIndex = null;
                job.state = 'Completed';
                this.jobs.delete(videoFileId);
                this.eventTarget.dispatchEvent(new Event('change'));
                return offlineVideo;
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
                key,
                videoId: videoFileId,
                generationId,
                program: snapshot,
                kind: 'hls',
                profile,
                profileLabel: infoOptions.profileLabel,
                sizeBytes,
                segmentCount: durations.get('video')?.length ?? 0,
                savedAt: Date.now(),
                playlistURL: new URL('playlist.m3u8', baseURL).toString(),
                thumbnailURLs,
                channelLogoURL: (await cache.match(channelLogoURL)) === undefined ? undefined : channelLogoURL,
                programInfo,
                durationSeconds: metadata.duration,
                chapters: chapters.length > 0 ? chapters : undefined,
                ...jikkyoParam,
            };
            await OfflineVideoStorage.put(video);
            this.savedVideoIndex = null;
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
        this.savedVideoIndex = null;
        this.eventTarget.dispatchEvent(new Event('change'));
    }

    /** 保存済み動画へ再生時に解決した実況パラメータを書き戻す。 */
    public static async updateJikkyoParam(video: OfflineVideoRecord, param: OfflineJikkyoParam): Promise<OfflineVideoRecord> {
        const updated = { ...video, ...param };
        await OfflineVideoStorage.put(updated);
        this.savedVideoIndex = this.savedVideoIndex?.map(item => item.key === updated.key ? updated : item) ?? null;
        this.eventTarget.dispatchEvent(new Event('change'));
        return updated;
    }
}
