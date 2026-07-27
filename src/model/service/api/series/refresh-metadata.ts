import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        api.responseJSON(res, 200, await model.refreshMetadata());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: 'シリーズのメタデータ再取得',
    tags: ['series'],
    description:
        '既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋め直す。' +
        '辞書の導入前に作られたシリーズや、辞書更新後の追随に使う',
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
