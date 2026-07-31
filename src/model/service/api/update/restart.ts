import { Operation } from 'express-openapi';
import IUpdateApiModel from '../../../api/update/IUpdateApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    try {
        const model = container.get<IUpdateApiModel>('IUpdateApiModel');
        api.responseJSON(res, 200, await model.restart());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'UpdateNotificationFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'UpdateIsAlreadyRunning') api.responseError(res, { code: 409, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: 'EPGStation の再起動',
    tags: ['update'],
    description:
        '更新を伴わずに EPGStation を再起動する。応答を返しきってからプロセスを終了するため、実際の停止は応答より少し後になる。サービス管理 (docker / systemd / pm2 / Windows サービス) の配下ならそれが起こし直し、検出できない場合は後継プロセスを自分で起動してから終了する',
    responses: {
        200: {
            description: '再起動を受け付けた',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateRestartResult' } } },
        },
        404: { description: '機能が無効' },
        409: { description: '更新が実行中のため再起動できない' },
        default: { description: '失敗' },
    },
};
