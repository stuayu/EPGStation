export interface OfflineVideoRecord {
    videoId: number;
    generationId: string;
    program: unknown;
    profile: string;
    sizeBytes: number;
    segmentCount: number;
    savedAt: number;
    playlistURL: string;
    thumbnailURLs?: string[];
}

const DB_NAME = 'epgstation-offline-videos';
const DB_VERSION = 1;
const VIDEO_STORE = 'videos';

/** オフライン番組のメタデータを IndexedDB に保存し、動画本体は Cache Storage に保存する。 */
export default class OfflineVideoStorage {
    private static dbPromise: Promise<IDBDatabase> | null = null;

    private static open(): Promise<IDBDatabase> {
        if (this.dbPromise !== null) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => request.result.createObjectStore(VIDEO_STORE, { keyPath: 'videoId' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けません。'));
        });
        return this.dbPromise;
    }

    public static async getAll(): Promise<OfflineVideoRecord[]> {
        const db = await this.open();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE).getAll();
            request.onsuccess = () => resolve((request.result as OfflineVideoRecord[]).sort((a, b) => b.savedAt - a.savedAt));
            request.onerror = () => reject(request.error ?? new Error('オフライン録画一覧を読み込めません。'));
        });
    }

    public static async get(videoId: number): Promise<OfflineVideoRecord | null> {
        const items = await this.getAll();
        return items.find(item => item.videoId === videoId) ?? null;
    }

    public static async put(video: OfflineVideoRecord): Promise<void> {
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const request = db.transaction(VIDEO_STORE, 'readwrite').objectStore(VIDEO_STORE).put(video);
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
            const request = db.transaction(VIDEO_STORE, 'readwrite').objectStore(VIDEO_STORE).delete(video.videoId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('オフライン録画を削除できません。'));
        });
    }
}
