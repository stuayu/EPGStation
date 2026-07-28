import { Operation } from 'express-openapi';
import IUpdateApiModel from '../../../api/update/IUpdateApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    try {
        const model = container.get<IUpdateApiModel>('IUpdateApiModel');
        api.responseJSON(res, 200, await model.check());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'UpdateNotificationFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '更新チェックの再実行',
    tags: ['update'],
    description: 'キャッシュを無視して GitHub のリリース情報を取得し直す',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateStatus' } } },
        },
        404: { description: '機能が無効' },
        default: { description: '失敗' },
    },
};
