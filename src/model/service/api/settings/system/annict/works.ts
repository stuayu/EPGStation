import { Operation } from 'express-openapi';
import IAnnictWorkApiModel from '../../../../../api/series/IAnnictWorkApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

const m = () => container.get<IAnnictWorkApiModel>('IAnnictWorkApiModel');
const fail = (res: any, e: unknown) => {
    const x = api.getErrorMessage(e);
    if (x === 'MetadataProvidersFeatureIsDisabled' || x === 'SystemSettingsFeatureIsDisabled')
        api.responseError(res, { code: 404, message: x });
    else api.responseServerError(res, x);
};

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await m().getStatus());
    } catch (e) {
        fail(res, e);
    }
};

export const post: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await m().sync());
    } catch (e) {
        fail(res, e);
    }
};

get.apiDoc = {
    summary: 'Annict 作品辞書の状態取得',
    tags: ['settings'],
    responses: {
        200: {
            description: '辞書の状態',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnnictWorkDictionaryStatus' } } },
        },
        default: { description: 'error' },
    },
};

post.apiDoc = {
    summary: 'Annict 作品辞書の同期実行',
    description: 'Annict は差分取得に対応しないため常に全作品 (約 1.7 万件) を取得し直す',
    tags: ['settings'],
    responses: {
        200: {
            description: '同期結果',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnnictWorkSyncResult' } } },
        },
        default: { description: 'error' },
    },
};
