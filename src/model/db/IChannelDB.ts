import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Channel from '../../db/entities/Channel';

export interface ChannelUpdateValues {
    insert: mapid.Service[];
    update: mapid.Service[];
}

export default interface IChannelDB {
    /**
     * channels を DB へ全件挿入 (無ければ更新) する。
     * 個々のレコードの失敗はログを出して続行するが、トランザクション自体が失敗した場合は throw する
     */
    insert(channels: mapid.Service[]): Promise<void>;
    update(values: ChannelUpdateValues): Promise<void>;
    findId(channelId: apid.ChannelId): Promise<Channel | null>;
    findNetworkIdAndServiceId(networkId: number, serviceId: number): Promise<Channel | null>;
    findChannleTypes(types: apid.ChannelType[], needSort?: boolean): Promise<Channel[]>;
    findAll(needSort?: boolean): Promise<Channel[]>;
}
