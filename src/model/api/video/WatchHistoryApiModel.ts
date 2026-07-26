import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import WatchHistory from '../../../db/entities/WatchHistory';
import IVideoFileDB from '../../db/IVideoFileDB';
import IWatchHistoryDB from '../../db/IWatchHistoryDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IWatchHistoryApiModel from './IWatchHistoryApiModel';
import { normalizePlaybackPosition } from './PlaybackPosition';
@injectable()
export default class WatchHistoryApiModel implements IWatchHistoryApiModel {
    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IWatchHistoryDB') private readonly db: IWatchHistoryDB,
        @inject('IVideoFileDB') private readonly videos: IVideoFileDB,
    ) {}
    public async get(id: apid.VideoFileId): Promise<apid.WatchHistory | null> {
        this.enabled();
        const h = await this.db.findByVideoFileId(id);
        return h === null ? null : this.api(h);
    }
    public async update(id: apid.VideoFileId, o: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory | null> {
        this.enabled();
        const v = await this.videos.findId(id);
        if (v === null) return null;
        const h = await this.db.upsert({
            videoFileId: id,
            recordedId: v.recordedId,
            ...normalizePlaybackPosition(o),
            updatedAt: Date.now(),
        });
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
