import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import WatchHistory from '../../../db/entities/WatchHistory';
import IAnnictSyncQueueModel from '../../metadata/annict/IAnnictSyncQueueModel';
import IVideoFileDB from '../../db/IVideoFileDB';
import IWatchHistoryDB from '../../db/IWatchHistoryDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IRecordedApiModel from '../recorded/IRecordedApiModel';
import IWatchHistoryApiModel from './IWatchHistoryApiModel';
import { normalizePlaybackPosition } from './PlaybackPosition';
@injectable()
export default class WatchHistoryApiModel implements IWatchHistoryApiModel {
    // 視聴履歴一覧で 1 回に返す既定件数
    private static readonly DEFAULT_LIMIT = 24;

    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IWatchHistoryDB') private readonly db: IWatchHistoryDB,
        @inject('IVideoFileDB') private readonly videos: IVideoFileDB,
        @inject('IAnnictSyncQueueModel') private readonly annictSyncQueue: IAnnictSyncQueueModel,
        @inject('IRecordedApiModel') private readonly recordedApiModel: IRecordedApiModel,
    ) {}

    /**
     * 視聴履歴を最後に見た順で取得する。
     * 録画が削除済みの履歴は recorded を null にして行だけ残す (画面から削除できるようにする)
     * @param option: apid.GetWatchHistoryOption
     * @return Promise<apid.WatchHistoryRecords>
     */
    public async gets(option: apid.GetWatchHistoryOption): Promise<apid.WatchHistoryRecords> {
        this.enabled();
        const [histories, total] = await this.db.findRecent({
            limit: typeof option.limit === 'number' ? option.limit : WatchHistoryApiModel.DEFAULT_LIMIT,
            offset: typeof option.offset === 'number' ? option.offset : 0,
            status: option.status,
        });

        // 同じ録画に複数のビデオファイルがある場合でも録画情報は 1 回だけ引く
        const recordedIndex = new Map<apid.RecordedId, apid.RecordedItem | null>();
        for (const recordedId of new Set(histories.map(h => h.recordedId))) {
            recordedIndex.set(
                recordedId,
                await this.recordedApiModel.get(recordedId, option.isHalfWidth).catch(() => null),
            );
        }

        return {
            total: total,
            records: histories.map(h => ({ ...this.api(h), recorded: recordedIndex.get(h.recordedId) ?? null })),
        };
    }

    /**
     * 視聴履歴を 1 件削除する
     * @param id: apid.VideoFileId
     * @return Promise<void>
     */
    public async delete(id: apid.VideoFileId): Promise<void> {
        this.enabled();
        await this.db.deleteByVideoFileId(id);
    }
    public async get(id: apid.VideoFileId): Promise<apid.WatchHistory | null> {
        this.enabled();
        const h = await this.db.findByVideoFileId(id);
        return h === null ? null : this.api(h);
    }
    public async update(id: apid.VideoFileId, o: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory | null> {
        this.enabled();
        const v = await this.videos.findId(id);
        if (v === null) return null;
        const previous = await this.db.findByVideoFileId(id);
        const h = await this.db.upsert({
            videoFileId: id,
            recordedId: v.recordedId,
            ...normalizePlaybackPosition(o),
            updatedAt: Date.now(),
        });
        // watched への遷移をトリガーに Annict 視聴記録同期をキューへ積む (§5.5, opt-in)
        // enqueueFromWatchHistory() は annictSync フラグが無効なら何もせず、失敗しても
        // ここでは無視する (視聴履歴の更新自体は成功させる: 障害分離)
        if (h.status === 'watched' && previous?.status !== 'watched') {
            this.annictSyncQueue.enqueueFromWatchHistory(h.recordedId);
        }
        return this.api(h);
    }
    private enabled(): void {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'watchHistory'))
            throw new Error('WatchHistoryFeatureIsDisabled');
    }
    private api(h: WatchHistory): apid.WatchHistory {
        return {
            videoFileId: h.videoFileId,
            recordedId: h.recordedId,
            position: h.position,
            duration: h.duration,
            status: h.status,
            updatedAt: Number(h.updatedAt),
        };
    }
}
