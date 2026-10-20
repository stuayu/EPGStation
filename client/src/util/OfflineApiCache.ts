export interface OfflineApiCacheRecord {
    key: string;
    url: string;
    user: string;
    savedAt: number;
    accessedAt?: number;
    size: number;
    response: unknown;
}

import {
    createOfflineApiCacheKey,
    isOfflineApiCacheAllowed,
    selectOfflineApiCacheEvictions,
    OFFLINE_API_CACHE_MAX_BYTES,
    OFFLINE_API_CACHE_MAX_ITEMS,
} from '../../../src/util/OfflineApiCacheUtil';
export { createOfflineApiCacheKey, isOfflineApiCacheAllowed, selectOfflineApiCacheEvictions, OFFLINE_API_CACHE_MAX_BYTES, OFFLINE_API_CACHE_MAX_ITEMS };
const DB_NAME = 'epgstation-offline-api';
const STORE_NAME = 'responses';

const openDatabase = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> => {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        run(tx.objectStore(STORE_NAME), resolve, reject);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
};

export default class OfflineApiCache {
    public static async get(key: string): Promise<OfflineApiCacheRecord | null> {
        return withStore('readwrite', (store, done, fail) => {
            const request = store.get(key);
            request.onsuccess = () => {
                const record = request.result as OfflineApiCacheRecord | undefined;
                if (!record) return done(null);
                record.accessedAt = Date.now();
                store.put(record);
                done(record);
            };
            request.onerror = () => fail(request.error);
        });
    }

    public static async put(record: OfflineApiCacheRecord): Promise<void> {
        const size = new Blob([JSON.stringify(record.response)]).size;
        if (size > OFFLINE_API_CACHE_MAX_BYTES) return;
        const entry = { ...record, size };
        const all = await withStore<OfflineApiCacheRecord[]>('readonly', (store, done, fail) => {
            const request = store.getAll();
            request.onsuccess = () => done(request.result);
            request.onerror = () => fail(request.error);
        });
        const evictions = selectOfflineApiCacheEvictions(
            all.filter(item => item.key !== record.key),
            size,
        );
        try {
            await withStore<void>('readwrite', (store, done) => {
                for (const key of evictions) store.delete(key);
                store.put(entry);
                done(undefined);
            });
        } catch {
            await withStore<void>('readwrite', (store, done) => {
                const oldestItems = [...all].sort((a, b) => (a.accessedAt ?? a.savedAt) - (b.accessedAt ?? b.savedAt));
                for (const item of oldestItems.slice(0, Math.max(1, evictions.length))) store.delete(item.key);
                store.put(entry);
                done(undefined);
            });
        }
    }

    public static async clear(): Promise<void> {
        await withStore<void>('readwrite', (store, done) => {
            store.clear();
            done(undefined);
        });
    }
}
