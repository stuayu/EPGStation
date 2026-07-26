import { Operation } from 'express-openapi';
import IAnnictSyncApiModel from '../../../../../api/series/IAnnictSyncApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (req, res) => {
    try {
        const id = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        api.responseJSON(res, 200, await container.get<IAnnictSyncApiModel>('IAnnictSyncApiModel').sync(id));
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
post.apiDoc = {
    summary: 'Annict作品同期',
    tags: ['series', 'metadata'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
