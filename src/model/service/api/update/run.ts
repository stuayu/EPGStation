import { Operation } from 'express-openapi';
import IUpdateApiModel from '../../../api/update/IUpdateApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<IUpdateApiModel>('IUpdateApiModel');
        api.responseJSON(res, 200, await model.run(req.body ?? {}));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'UpdateNotificationFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'UpdateIsAlreadyRunning') api.responseError(res, { code: 409, message });
        else if (
            message === 'UpdateIsNotSupported' ||
            message === 'UpdateTargetIsNotFound' ||
            message === 'InvalidUpdateTag'
        )
            api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '更新の実行',
    tags: ['update'],
    description:
        '指定したタグ (省略時は最新リリース) へ更新する。git fetch → checkout → 依存インストール → ビルドを行い、restart が true なら完了後に EPGStation を再起動する',
    requestBody: {
        required: false,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/RunUpdateOption' } } },
    },
    responses: {
        200: {
            description: '開始した',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateJob' } } },
        },
        400: { description: '更新できない / 対象が不正' },
        404: { description: '機能が無効' },
        409: { description: 'すでに更新が実行中' },
        default: { description: '失敗' },
    },
};
