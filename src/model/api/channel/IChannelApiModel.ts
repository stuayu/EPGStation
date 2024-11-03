import * as apid from '../../../../api';

export namespace IChannelApiModelError {
    export const NOT_FOUND = 'notfound';
}

export default interface IChannelApiModel {
    getChannels(channelId: apid.ChannelId): Promise<apid.ChannelItem[]>;
    getLogo(channelId: apid.ChannelId): Promise<Buffer>;
}
