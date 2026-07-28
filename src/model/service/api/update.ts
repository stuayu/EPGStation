import { Operation } from 'express-openapi';
import IUpdateApiModel from '../../api/update/IUpdateApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<IUpdateApiModel>('IUpdateApiModel');
        api.responseJSON(res, 200, await model.getStatus());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'UpdateNotificationFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '更新状況の取得',
    tags: ['update'],
    description: '現在のバージョン・公開されている最新リリース・導入形態・実行中の更新ジョブを返す',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateStatus' } } },
        },
        404: { description: '機能が無効' },
        default: { description: '失敗' },
    },
};
