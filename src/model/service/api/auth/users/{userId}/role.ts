import { Operation } from 'express-openapi';
import IAuthModel from '../../../../../auth/IAuthModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const put: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        const userId = api.parseRequestParamInt(String(req.params.userId), 'userId');
        await model.setRole(userId, String(req.body?.role ?? ''));
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'AuthIsDisabled' || message === 'UserIsNotFound')
            api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRole') api.responseError(res, { code: 400, message });
        else if (message === 'LastAdminCanNotBeDemoted') api.responseError(res, { code: 409, message });
        else api.responseServerError(res, message);
    }
};

put.apiDoc = {
    summary: '権限の変更',
    tags: ['auth'],
    description:
        'システム管理者 (admin) と一般 (user) を切り替える。最後のシステム管理者は降格できない。反映は最大 30 秒 (権限キャッシュの保持時間) 遅れる',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUserRoleOption' } } },
    },
    responses: {
        200: { description: '成功' },
        400: { description: '不正な権限' },
        404: { description: 'ユーザーが見つからない' },
        409: { description: '最後のシステム管理者は降格できない' },
        default: { description: '失敗' },
    },
};
