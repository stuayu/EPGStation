import { Operation } from 'express-openapi';
import ISeriesPendingApiModel from '../../../api/series/ISeriesPendingApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesPendingApiModel>('ISeriesPendingApiModel');
        const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
        api.responseJSON(res, 200, await model.list(offset, limit));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: 'シリーズ未確定キュー一覧',
    tags: ['series'],
    parameters: [{ $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Limit' }],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
