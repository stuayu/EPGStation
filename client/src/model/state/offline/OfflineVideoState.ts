import { injectable } from 'inversify';
import OfflineVideos from '@/services/OfflineVideos';
import OfflineVideoStorage, { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import { findOfflineVideoByKey } from '../../../../../src/util/OfflineUxUtil';
import IOfflineVideoState from './IOfflineVideoState';

@injectable()
export default class OfflineVideoState implements IOfflineVideoState {
    public videos: OfflineVideoRecord[] = [];

    /** 保存済み動画一覧を読み込む。 */
    public async load(): Promise<void> {
        this.videos = await OfflineVideoStorage.getAll();
    }

    /** URL のキーから保存済み動画を取得する。 */
    public find(key: string): OfflineVideoRecord | null {
        return findOfflineVideoByKey(this.videos, key);
    }

    /** 保存済み動画と関連キャッシュを削除する。 */
    public async remove(video: OfflineVideoRecord): Promise<void> {
        await OfflineVideos.delete(video);
        this.videos = this.videos.filter(item => item.key !== video.key);
    }
}
