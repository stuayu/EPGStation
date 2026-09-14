import type { OfflineVideoRecord } from '@/services/OfflineVideoStorage';

export default interface IOfflineVideoState {
    videos: OfflineVideoRecord[];
    load(): Promise<void>;
    find(key: string): OfflineVideoRecord | null;
    remove(video: OfflineVideoRecord): Promise<void>;
}
