import { Operation } from 'express-openapi';
import ISeriesAliasApiModel from '../../../../api/series/ISeriesAliasApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const del: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesAliasApiModel>('ISeriesAliasApiModel');
        const aliasId = api.parseRequestParamInt(String(req.params.aliasId), 'aliasId');
        await model.remove(aliasId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
del.apiDoc = {
    summary: 'シリーズエイリアス削除',
    tags: ['series'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};

export const put: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesAliasApiModel>('ISeriesAliasApiModel');
        const aliasId = api.parseRequestParamInt(String(req.params.aliasId), 'aliasId');
        api.responseJSON(res, 200, await model.update(aliasId, req.body ?? {}));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesAliasIsNotFound' || message === 'SeriesIsNotFound')
            api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
put.apiDoc = {
    summary: 'シリーズエイリアスの付け替え',
    tags: ['series'],
    description:
        'LLM が誤学習した「正規化タイトル → シリーズ」の対応を正しいシリーズへ付け替える。付け替えた辞書は手動修正扱い (source: manual) になる',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateSeriesAliasOption' } } },
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SeriesAliasItem' } } },
        },
        400: { description: '不正なリクエスト' },
        404: { description: 'エイリアス / シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
