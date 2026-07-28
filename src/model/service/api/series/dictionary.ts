import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : '';
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
        if (typeof limit === 'number' && Number.isFinite(limit) === false) throw new Error('InvalidRequestBody');
        api.responseJSON(res, 200, await model.searchDictionary(keyword, limit));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '作品辞書 (しょぼいカレンダー / Annict / Wikidata) の横断検索',
    tags: ['series'],
    parameters: [
        {
            name: 'keyword',
            in: 'query',
            required: true,
            description: '検索キーワード',
            schema: { type: 'string' },
        },
        {
            name: 'limit',
            in: 'query',
            required: false,
            description: '最大件数',
            schema: { type: 'integer' },
        },
    ],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/DictionaryWorkSearchResult' } },
            },
        },
        400: { description: '不正なリクエスト' },
        404: { description: 'シリーズ機能が無効' },
        default: { description: '失敗' },
    },
};
export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const body = req.body ?? {};
        api.responseJSON(
            res,
            201,
            await model.createFromDictionary({
                syobocalTid: typeof body.syobocalTid === 'undefined' ? null : Number(body.syobocalTid),
                annictId: typeof body.annictId === 'undefined' ? null : Number(body.annictId),
                wikidataQid: typeof body.wikidataQid === 'string' ? body.wikidataQid : null,
            }),
        );
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'DictionaryWorkIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: '辞書の作品からシリーズを作成する',
    tags: ['series'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/CreateSeriesFromDictionaryOption' },
            },
        },
    },
    responses: {
        201: {
            description: '成功',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/CreateSeriesFromDictionaryResult' } },
            },
        },
        400: { description: '不正なリクエスト' },
        404: { description: '辞書に該当作品が無い / シリーズ機能が無効' },
        default: { description: '失敗' },
    },
};
