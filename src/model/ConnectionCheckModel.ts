import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import Util from '../util/Util';
import IDBOperator from './db/IDBOperator';
import IConnectionCheckModel from './IConnectionCheckModel';
import ILogger from './ILogger';
import ILoggerModel from './ILoggerModel';
import IMirakurunClientModel from './IMirakurunClientModel';

@injectable()
class ConnectionCheckModel implements IConnectionCheckModel {
    private log: ILogger;
    private mirakurunClient: mirakurun;
    private dbOperator: IDBOperator;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('IDBOperator') dbOperator: IDBOperator,
    ) {
        this.log = logger.getLogger();
        this.mirakurunClient = mirakurunClientModel.getClient();
        this.dbOperator = dbOperator;
    }

    /**
     * mirakurun との接続確認を行う
     * 起動をブロックしないよう、有限回のリトライで打ち切る (無限リトライはしない)
     * mirakurun に接続できなくても false を返すのみで例外は投げない
     * @return Promise<boolean> 接続できたか
     */
    public async checkMirakurun(): Promise<boolean> {
        for (let i = 0; i < ConnectionCheckModel.MIRAKURUN_RETRY_COUNT; i++) {
            try {
                this.log.system.info('check mirakurun');
                await Util.promiseTimeout(
                    this.mirakurunClient.getStatus(),
                    ConnectionCheckModel.MIRAKURUN_CHECK_TIMEOUT,
                );

                return true;
            } catch (err: any) {
                if (i < ConnectionCheckModel.MIRAKURUN_RETRY_COUNT - 1) {
                    await Util.sleep(ConnectionCheckModel.MIRAKURUN_RETRY_INTERVAL);
                }
            }
        }

        this.log.system.warn('mirakurun へ接続できませんでした');
        this.log.system.warn(
            'config.yml の mirakurunPath の設定と、Mirakurun サービスが起動しているかを確認してください',
        );
        this.log.system.warn('Web UI は起動しますが、Mirakurun が復旧するまで番組表・録画機能は利用できません');

        return false;
    }

    /**
     * DB との接続を待つ
     */
    public async checkDB(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('check db');
                await this.dbOperator.checkConnection();
                break;
            } catch (err: any) {
                await Util.sleep(1000);
            }
        }
    }
}

namespace ConnectionCheckModel {
    // mirakurun への疎通確認を試行する回数
    export const MIRAKURUN_RETRY_COUNT = 3;
    // mirakurun への疎通確認のリトライ間隔 (ms)
    export const MIRAKURUN_RETRY_INTERVAL = 1000;
    // mirakurun への疎通確認 1 回あたりのタイムアウト (ms)
    export const MIRAKURUN_CHECK_TIMEOUT = 3000;
}

export default ConnectionCheckModel;
