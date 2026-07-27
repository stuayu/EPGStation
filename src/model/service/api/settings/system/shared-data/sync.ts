import { Operation } from 'express-openapi';
import IConfiguration from '../../../../../IConfiguration';
import { isFeatureEnabled } from '../../../../../FeatureFlags';
import ISharedDataFetcher from '../../../../../metadata/ISharedDataFetcher';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (_req, res) => {
    try {
        const config = container.get<IConfiguration>('IConfiguration');
        if (!isFeatureEnabled(config.getConfig(), 'systemSettings')) {
            api.responseError(res, { code: 404, message: 'SystemSettingsFeatureIsDisabled' });
            return;
        }
        const fetcher = container.get<ISharedDataFetcher>('ISharedDataFetcher');
        const payload = await fetcher.syncNow();
        api.responseJSON(res, 200, { updated: payload !== null });
    } catch (e) {
        api.responseError(res, { code: 400, message: api.getErrorMessage(e) });
    }
};
post.apiDoc = {
    summary: '共有静的データ (チャンネルマッピング表・エイリアス辞書) を今すぐ同期',
    tags: ['settings'],
    requestBody: {
        content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
    responses: {
        200: {
            description: '結果',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SharedDataSyncResult' } } },
        },
        default: { description: 'error' },
    },
};
