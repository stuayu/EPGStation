import { Operation } from 'express-openapi';
import ISeriesAliasApiModel from '../../../api/series/ISeriesAliasApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesAliasApiModel>('ISeriesAliasApiModel');
        const seriesId = typeof req.query.seriesId === 'string' ? Number(req.query.seriesId) : undefined;
        api.responseJSON(res, 200, await model.list(seriesId));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: 'シリーズエイリアス辞書一覧',
    tags: ['series'],
    parameters: [{ $ref: '#/components/parameters/QuerySeriesId' }],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
