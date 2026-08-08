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
        let lastError: any = null;

        for (let i = 0; i < ConnectionCheckModel.MIRAKURUN_RETRY_COUNT; i++) {
            try {
                this.log.system.info('check mirakurun');
                await Util.promiseTimeout(
                    this.mirakurunClient.getStatus(),
                    ConnectionCheckModel.MIRAKURUN_CHECK_TIMEOUT,
                );

                return true;
            } catch (err: any) {
                lastError = err;
                if (i < ConnectionCheckModel.MIRAKURUN_RETRY_COUNT - 1) {
                    await Util.sleep(ConnectionCheckModel.MIRAKURUN_RETRY_INTERVAL);
                }
            }
        }

        this.log.system.warn('mirakurun へ接続できませんでした');
        this.log.system.warn(
            'config.yml の mirakurunPath の設定と、Mirakurun サービスが起動しているかを確認してください',
        );
        await this.logDocsResolutionHintIfNeeded(lastError);
        this.log.system.warn('Web UI は起動しますが、Mirakurun が復旧するまで番組表・録画機能は利用できません');

        return false;
    }

    /**
     * getStatus() の失敗が「docs (OpenAPI 定義) から operationId を解決できなかったこと」に
     * 起因するかを判定し、該当する場合は docs の取得可否を明示的に確認してログへ原因を出す。
     *
     * mirakurun クライアントは呼び出しのたびに `GET {basePath}/docs` を取得して operationId から
     * HTTP パスを解決するため (`node_modules/mirakurun/lib/client.js`)、
     * /docs を提供しない、または Mirakurun と互換性の無い内容を返すサーバーに接続すると、
     * getStatus() を含むすべての API 呼び出しが `operationId "xxx" is not found.` という
     * 一見原因の分かりにくいエラーで失敗する。このメソッドはその原因を利用者に分かる形で出す
     * @param lastError: any checkMirakurun() で最後に発生したエラー
     */
    private async logDocsResolutionHintIfNeeded(lastError: any): Promise<void> {
        const isOperationIdError =
            typeof lastError?.message === 'string' &&
            ConnectionCheckModel.OPERATION_ID_NOT_FOUND_REGEXP.test(lastError.message);
        const docsStatus = typeof lastError?.status === 'number' ? lastError.status : undefined;
        const isDocsEndpointMissing = docsStatus === 404 || docsStatus === 501;

        if (isOperationIdError === false && isDocsEndpointMissing === false) {
            return;
        }

        // docs の取得可否を明示的に 1 回確認し、「docs 自体が取得できないのか」
        // 「docs は取得できたが内容が Mirakurun と一致しないのか」を切り分ける
        try {
            await Util.promiseTimeout(this.mirakurunClient.getDocs(), ConnectionCheckModel.MIRAKURUN_CHECK_TIMEOUT);
            this.log.system.warn(
                'Mirakurun の /docs (OpenAPI 定義) は取得できましたが、内容が Mirakurun と一致しないため API を解決できません。' +
                    '接続先が Mirakurun 互換サーバーの場合、/docs の実装差異が原因の可能性があります',
            );
        } catch (docsErr: any) {
            this.log.system.warn(
                'Mirakurun の /docs (OpenAPI 定義) が取得できないため、API を解決できません。' +
                    '接続先が /docs エンドポイントを提供していない可能性があります',
            );
        }
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
    // mirakurun クライアントが operationId を解決できなかったときに投げる Error のメッセージパターン
    export const OPERATION_ID_NOT_FOUND_REGEXP = /operationId ".*" is not found\.?/;
}

export default ConnectionCheckModel;
