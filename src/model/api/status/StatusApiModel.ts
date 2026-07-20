import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import Util from '../../../util/Util';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IStatusApiModel from './IStatusApiModel';

@injectable()
class StatusApiModel implements IStatusApiModel {
    private mirakurunClient: mirakurun;

    constructor(@inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel) {
        this.mirakurunClient = mirakurunClientModel.getClient();
    }

    /**
     * 外部サービスとの接続状態を取得する
     * @return Promise<apid.Status>
     */
    public async getStatus(): Promise<apid.Status> {
        let isAlive = true;
        try {
            await Util.promiseTimeout(this.mirakurunClient.getStatus(), StatusApiModel.MIRAKURUN_CHECK_TIMEOUT);
        } catch (err: any) {
            isAlive = false;
        }

        return {
            mirakurun: {
                isAlive: isAlive,
                checkedAt: new Date().getTime(),
            },
        };
    }
}

namespace StatusApiModel {
    // mirakurun への疎通確認のタイムアウト (ms)
    export const MIRAKURUN_CHECK_TIMEOUT = 3000;
}

export default StatusApiModel;
