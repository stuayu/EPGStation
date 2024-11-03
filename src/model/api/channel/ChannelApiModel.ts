import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import Channel from '../../../db/entities/Channel';
import IChannelDB from '../../db/IChannelDB';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IChannelApiModel, { IChannelApiModelError } from './IChannelApiModel';

@injectable()
class ChannelApiModel implements IChannelApiModel {
    private channelDB: IChannelDB;
    private mirakurunClient: mirakurun;

    constructor(
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.channelDB = channelDB;
        this.mirakurunClient = mirakurunClientModel.getClient();
    }

    /**
     * チャンネル情報取得
     * @param channelId: apid.ChannelId
     * @return Promise<ChannelItem[]>
     */
    public async getChannels(channelId: apid.ChannelId): Promise<apid.ChannelItem[]> {
        let channels: Channel[] = [];
        if (!channelId) {
            channels = await this.channelDB.findAll(true);
        } else {
            const channel = await this.channelDB.findId(channelId);
            if (channel) {
                channels = [channel];
            }
        }

        return channels.map(c => {
            const result: apid.ChannelItem = {
                id: c.id,
                serviceId: c.serviceId,
                networkId: c.networkId,
                name: c.name,
                halfWidthName: c.halfWidthName,
                hasLogoData: c.hasLogoData,
                channelType: <any>c.channelType,
                channel: c.channel,
                type: c.type,
            };

            if (c.remoteControlKeyId !== null) {
                result.remoteControlKeyId = c.remoteControlKeyId;
            }

            return result;
        });
    }

    /**
     * logo 取得
     * @param channelId: apid.ChannelId
     * @return Promise<Buffer>
     */
    public async getLogo(channelId: apid.ChannelId): Promise<Buffer> {
        const channel = await this.channelDB.findId(channelId);

        if (channel === null || channel.hasLogoData === false) {
            throw new Error(IChannelApiModelError.NOT_FOUND);
        }

        return this.mirakurunClient.getLogoImage(channelId);
    }
}

export default ChannelApiModel;
