import { Operation } from 'express-openapi';
import IUpdateApiModel from '../../../api/update/IUpdateApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<IUpdateApiModel>('IUpdateApiModel');
        api.responseJSON(res, 200, await model.getJob());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'UpdateNotificationFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '更新ジョブの進捗取得',
    tags: ['update'],
    description: '実行中・直近の更新ジョブの状態とログを返す (更新中の画面はこれをポーリングする)',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateJob' } } },
        },
        404: { description: '機能が無効' },
        default: { description: '失敗' },
    },
};
