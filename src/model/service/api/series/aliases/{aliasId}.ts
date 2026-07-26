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
