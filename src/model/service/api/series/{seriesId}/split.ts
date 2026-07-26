import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const seriesId = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        const body = req.body ?? {};
        const value = await model.split(seriesId, body.recordedIds, body.newTitle);
        api.responseJSON(res, 200, value);
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: 'シリーズの分割 (指定した録画群を新シリーズへ分離)',
    tags: ['series'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['recordedIds', 'newTitle'],
                    properties: {
                        recordedIds: { type: 'array', items: { type: 'number' } },
                        newTitle: { type: 'string' },
                    },
                },
            },
        },
    },
    responses: {
        200: { description: '成功' },
        400: { description: '不正なリクエスト' },
        404: { description: 'シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
