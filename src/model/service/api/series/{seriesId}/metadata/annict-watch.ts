import { Operation } from 'express-openapi';
import IAnnictSyncApiModel from '../../../../../api/series/IAnnictSyncApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (req, res) => {
    try {
        const id = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        api.responseJSON(
            res,
            200,
            await container.get<IAnnictSyncApiModel>('IAnnictSyncApiModel').syncWatchRecords(id),
        );
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'AnnictSyncFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'AnnictWorkIsNotFound') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: 'Annict視聴記録の手動再同期',
    tags: ['series', 'metadata'],
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnnictWatchSyncResult' } } },
        },
        404: { description: '機能無効 / シリーズ未検出 / 作品未検出' },
        default: { description: '失敗' },
    },
};
