import { Operation } from 'express-openapi';
import IAuthModel from '../../../../auth/IAuthModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

const fail = (res: any, e: unknown): void => {
    const message = api.getErrorMessage(e);
    if (message === 'AuthIsDisabled' || message === 'UserIsNotFound') api.responseError(res, { code: 404, message });
    else if (message === 'InvalidCredentials') api.responseError(res, { code: 401, message });
    else if (message === 'LastUserCanNotBeRemoved') api.responseError(res, { code: 409, message });
    else if (message === 'InvalidPassword' || message === 'PasswordIsTooShort' || message === 'PasswordIsTooLong')
        api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};

export const put: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        const userId = api.parseRequestParamInt(String(req.params.userId), 'userId');
        const body = req.body ?? {};
        const currentPassword =
            typeof body.currentPassword === 'string' && body.currentPassword !== '' ? body.currentPassword : undefined;
        await model.changePassword(userId, String(body.newPassword ?? ''), currentPassword);
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        fail(res, e);
    }
};

export const del: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        const userId = api.parseRequestParamInt(String(req.params.userId), 'userId');
        await model.removeUser(userId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        fail(res, e);
    }
};

put.apiDoc = {
    summary: 'パスワードの変更',
    tags: ['auth'],
    description: '変更すると、そのユーザーの発行済みセッションはすべて無効になる',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordOption' } } },
    },
    responses: {
        200: { description: '成功' },
        400: { description: '入力が不正' },
        401: { description: '現在のパスワードが違う' },
        404: { description: 'ユーザーが見つからない' },
        default: { description: '失敗' },
    },
};

del.apiDoc = {
    summary: 'ログインユーザーの削除',
    tags: ['auth'],
    responses: {
        200: { description: '成功' },
        404: { description: 'ユーザーが見つからない' },
        409: { description: '最後の 1 人は削除できない' },
        default: { description: '失敗' },
    },
};
