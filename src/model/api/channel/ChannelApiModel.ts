import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import Channel from '../../../db/entities/Channel';
import IBroadcastAffiliation from '../../channel/IBroadcastAffiliation';
import IBroadcastRegion from '../../channel/IBroadcastRegion';
import IChannelDB from '../../db/IChannelDB';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IChannelApiModel, { IChannelApiModelError } from './IChannelApiModel';

@injectable()
class ChannelApiModel implements IChannelApiModel {
    private channelDB: IChannelDB;
    private mirakurunClient: mirakurun;
    private broadcastRegion: IBroadcastRegion;
    private broadcastAffiliation: IBroadcastAffiliation;

    constructor(
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('IBroadcastRegion') broadcastRegion: IBroadcastRegion,
        @inject('IBroadcastAffiliation') broadcastAffiliation: IBroadcastAffiliation,
    ) {
        this.channelDB = channelDB;
        this.mirakurunClient = mirakurunClientModel.getClient();
        this.broadcastRegion = broadcastRegion;
        this.broadcastAffiliation = broadcastAffiliation;
    }

    /**
     * チャンネル情報取得
     * @param channelId: apid.ChannelId
     * @return Promise<ChannelItem[]>
     */
    public async getChannels(channelId: apid.ChannelId): Promise<apid.ChannelItem[]> {
        await this.broadcastAffiliation.updateCache();

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

            // 地上波系は地域情報を付与する
            const region = this.broadcastRegion.getRegion({
                networkId: c.networkId,
                serviceId: c.serviceId,
                channelType: c.channelType,
            });
            if (region !== null) {
                result.region = region;
            }

            // 地上波系は BIT から収集した系列情報を付与する (未受信の局は局名から同梱データで補う)
            const affiliation = this.broadcastAffiliation.getAffiliation({
                networkId: c.networkId,
                channelType: c.channelType,
                name: c.halfWidthName ?? c.name,
            });
            if (affiliation !== null) {
                result.affiliation = affiliation;
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
