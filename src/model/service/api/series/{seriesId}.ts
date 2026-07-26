import { Operation } from 'express-openapi';
import ISeriesApiModel from '../../../api/series/ISeriesApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesApiModel>('ISeriesApiModel');
        const id = api.parseRequestParamInt(req.params.seriesId, 'seriesId');
        const channelId = typeof req.query.channelId === 'string' ? Number(req.query.channelId) : undefined;
        const result = await model.get(id, channelId);
        if (result) api.responseJSON(res, 200, result);
        else api.responseError(res, { code: 404, message: 'series is not found' });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: 'シリーズ詳細',
    tags: ['series'],
    responses: { 200: { description: '成功' }, 404: { description: '未検出' }, default: { description: '失敗' } },
};
