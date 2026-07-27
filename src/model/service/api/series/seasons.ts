import { Operation } from 'express-openapi';
import ISeriesApiModel from '../../../api/series/ISeriesApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<ISeriesApiModel>('ISeriesApiModel');
        api.responseJSON(res, 200, await model.listSeasons());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: 'シリーズのクール一覧',
    tags: ['series'],
    description: '絞り込み UI 用に、登録されているクール (年 + 春夏秋冬) を新しい順で返す',
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
