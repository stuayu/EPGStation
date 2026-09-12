import internal from 'stream';
import * as apid from '../../../../../api';

/** ライブ共有受信の配信単位 lease */
export interface LiveStreamSourceLease {
    stream: internal.Readable;
    release(): void;
}

export default interface ILiveStreamSourceManageModel {
    /**
     * channelId 単位で共有する Mirakurun 受信から配信枝を取得する
     * @param channelId: apid.ChannelId
     * @param priority: number Mirakurun の受信優先度
     * @return Promise<LiveStreamSourceLease>
     */
    acquire(channelId: apid.ChannelId, priority: number): Promise<LiveStreamSourceLease>;
}
