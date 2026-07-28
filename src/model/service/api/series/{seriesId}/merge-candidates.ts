import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const seriesId = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        api.responseJSON(res, 200, await model.listMergeCandidates(seriesId));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: 'マージ候補の取得 (正規化タイトルの前方一致)',
    tags: ['series'],
    description:
        '指定シリーズと正規化タイトルの先頭が一致するシリーズを、一致種別 (完全一致 → 前方一致 → 部分一致) の順で返す',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SeriesMergeCandidateResult' } } },
        },
        404: { description: 'シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
