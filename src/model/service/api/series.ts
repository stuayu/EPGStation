import { Operation } from 'express-openapi';
import ISeriesApiModel from '../../api/series/ISeriesApiModel';
import container from '../../ModelContainer';
import * as api from '../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesApiModel>('ISeriesApiModel');
        const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
        const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
        api.responseJSON(
            res,
            200,
            await model.list(typeof req.query.keyword === 'string' ? req.query.keyword : undefined, offset, limit),
        );
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: 'シリーズ一覧',
    tags: ['series'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
