import { createOfflineVideoKey, getOfflineVideoKey } from '../../../src/util/OfflineUxUtil';

export interface OfflineVideoRecord {
    key?: string;
    videoId: number;
    generationId: string;
    program: unknown;
    // 旧形式には無い。無い場合は HLS 保存として扱う。
    kind?: 'hls' | 'original-mpeg2';
    profile: string;
    // 旧形式には無い。無い場合は profile (内部 id) を表示する
    profileLabel?: string;
    sizeBytes: number;
    segmentCount: number;
    savedAt: number;
    playlistURL: string;
    thumbnailURLs?: string[];
    channelLogoURL?: string;
    programInfo?: unknown;
    originalURL?: string;
    originalFileSize?: number;
    originalChunkSize?: number;
    durationSeconds?: number;
    // 旧形式には無い。保存時に解決できたニコニコ実況過去ログの範囲。
    jikkyoChannelId?: string;
    jikkyoStartAt?: number;
    jikkyoEndAt?: number;
}

const DB_NAME = 'epgstation-offline-videos';
const DB_VERSION = 2;
const VIDEO_STORE = 'videos-v2';
const LEGACY_VIDEO_STORE = 'videos';

/** オフライン番組のメタデータを IndexedDB に保存し、動画本体は Cache Storage に保存する。 */
export default class OfflineVideoStorage {
    private static dbPromise: Promise<IDBDatabase> | null = null;

    private static open(): Promise<IDBDatabase> {
        if (this.dbPromise !== null) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                const transaction = request.transaction;
                if (transaction === null) return;
                const store = db.objectStoreNames.contains(VIDEO_STORE) ? transaction.objectStore(VIDEO_STORE) : db.createObjectStore(VIDEO_STORE, { keyPath: 'key' });
                if (db.objectStoreNames.contains(LEGACY_VIDEO_STORE) === false) return;
                const legacy = transaction.objectStore(LEGACY_VIDEO_STORE);
                const cursorRequest = legacy.openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (cursor === null) return;
                    const value = cursor.value as OfflineVideoRecord;
                    const key = value.key ?? createOfflineVideoKey(value.videoId, value.generationId);
                    if (key !== '') store.put({ ...value, key });
                    cursor.continue();
                };
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けません。'));
        });
        return this.dbPromise;
    }

    public static async getAll(): Promise<OfflineVideoRecord[]> {
        const db = await this.open();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE).getAll();
            request.onsuccess = () => resolve((request.result as OfflineVideoRecord[]).map(video => ({
                ...video,
                key: video.key ?? createOfflineVideoKey(video.videoId, video.generationId),
            })).sort((a, b) => b.savedAt - a.savedAt));
            request.onerror = () => reject(request.error ?? new Error('オフライン録画一覧を読み込めません。'));
        });
    }

    public static async get(videoId: number): Promise<OfflineVideoRecord | null> {
        const items = await this.getAll();
        return items.find(item => item.videoId === videoId) ?? null;
    }

    public static async getByKey(key: string): Promise<OfflineVideoRecord | null> {
        const db = await this.open();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE).get(key);
            request.onsuccess = () => resolve((request.result as OfflineVideoRecord | undefined) ?? null);
            request.onerror = () => reject(request.error ?? new Error('オフライン録画を読み込めません。'));
        });
    }

    public static async put(video: OfflineVideoRecord): Promise<void> {
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const key = getOfflineVideoKey(video);
            if (key === '') {
                reject(new Error('オフライン録画のキーが不正です。'));
                return;
            }
            // 画面から渡されるレコードは Vue のリアクティブ Proxy (入れ子の program 等も) のことがあり、
            // IndexedDB の structured clone は Proxy を複製できず DataCloneError になる。
            // 保存レコードは JSON で表せる値だけなので、深いコピーで素のオブジェクトにしてから保存する
            const plain = JSON.parse(JSON.stringify({ ...video, key })) as OfflineVideoRecord;
            const request = db.transaction(VIDEO_STORE, 'readwrite').objectStore(VIDEO_STORE).put(plain);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('オフライン録画を保存できません。'));
        });
    }

    public static async delete(video: OfflineVideoRecord): Promise<void> {
        const cache = await caches.open('epgstation-offline-videos');
        const keys = await cache.keys();
        await Promise.all(keys.filter(key => key.url.includes(`/local/offline/${video.videoId}/${video.generationId}/`)).map(key => cache.delete(key)));
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const key = getOfflineVideoKey(video);
            const request = db.transaction(VIDEO_STORE, 'readwrite').objectStore(VIDEO_STORE).delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('オフライン録画を削除できません。'));
        });
    }
}
