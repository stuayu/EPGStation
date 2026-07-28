import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const body = req.body ?? {};
        // 統合元は複数指定 (fromSeriesIds) を基本にし、旧来の単体指定 (fromSeriesId) も受け付ける
        const sources = Array.isArray(body.fromSeriesIds)
            ? body.fromSeriesIds.map((x: unknown) => Number(x))
            : [Number(body.fromSeriesId)];
        if (sources.some((x: number) => Number.isInteger(x) === false)) throw new Error('InvalidRequestBody');
        const value = await model.merge(sources, Number(body.toSeriesId));
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
    summary: 'シリーズのマージ (fromSeriesIds を toSeriesId へ統合)',
    tags: ['series'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/MergeSeriesOption' },
            },
        },
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MergeSeriesResult' } } },
        },
        400: { description: '不正なリクエスト' },
        404: { description: 'シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
