import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import ITunerApiModel from './ITunerApiModel';

export const toTunerItems = (tuners: Awaited<ReturnType<mirakurun['getTuners']>>): apid.TunerItems =>
    tuners.map(tuner => ({
        index: tuner.index,
        name: tuner.name,
        types: tuner.types as apid.ChannelType[],
        isUsing: tuner.isUsing,
    }));

@injectable()
export default class TunerApiModel implements ITunerApiModel {
    private client: mirakurun;

    constructor(@inject('IMirakurunClientModel') clientModel: IMirakurunClientModel) {
        this.client = clientModel.getClient();
    }

    /** Mirakurun のチューナー一覧を取得する */
    public async gets(): Promise<apid.TunerItems> {
        return toTunerItems(await this.client.getTuners());
    }
}
