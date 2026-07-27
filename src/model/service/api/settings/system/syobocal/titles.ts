import { Operation } from 'express-openapi';
import ISyobocalTitleApiModel from '../../../../../api/series/ISyobocalTitleApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

const m = () => container.get<ISyobocalTitleApiModel>('ISyobocalTitleApiModel');
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

export const post: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, await m().sync(req.body?.full === true));
    } catch (e) {
        fail(res, e);
    }
};

get.apiDoc = {
    summary: 'しょぼいカレンダー アニメ作品タイトル辞書の状態取得',
    tags: ['settings'],
    responses: {
        200: {
            description: '辞書の状態',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SyobocalTitleDictionaryStatus' } },
            },
        },
        default: { description: 'error' },
    },
};

post.apiDoc = {
    summary: 'しょぼいカレンダー アニメ作品タイトル辞書の同期実行',
    description: '既定は前回取得以降の差分のみ取得する。full: true で全件を取り直す',
    tags: ['settings'],
    requestBody: {
        required: false,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { full: { type: 'boolean' } },
                },
            },
        },
    },
    responses: {
        200: {
            description: '同期結果',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/SyobocalTitleSyncResult' } },
            },
        },
        default: { description: 'error' },
    },
};
