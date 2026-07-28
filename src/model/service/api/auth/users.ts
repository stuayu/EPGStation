import { Operation } from 'express-openapi';
import IAuthModel from '../../../auth/IAuthModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const fail = (res: any, e: unknown): void => {
    const message = api.getErrorMessage(e);
    if (message === 'AuthIsDisabled') api.responseError(res, { code: 404, message });
    else if (
        message === 'InvalidUserName' ||
        message === 'InvalidPassword' ||
        message === 'PasswordIsTooShort' ||
        message === 'PasswordIsTooLong' ||
        message === 'UserNameIsAlreadyUsed'
    )
        api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await container.get<IAuthModel>('IAuthModel').listUsers());
    } catch (e) {
        fail(res, e);
    }
};

export const post: Operation = async (req, res) => {
    try {
        const body = req.body ?? {};
        const model = container.get<IAuthModel>('IAuthModel');
        api.responseJSON(res, 200, await model.addUser(String(body.name ?? ''), String(body.password ?? '')));
    } catch (e) {
        fail(res, e);
    }
};

get.apiDoc = {
    summary: 'ログインユーザー一覧',
    tags: ['auth'],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/AuthUserItem' } },
                },
            },
        },
        default: { description: '失敗' },
    },
};

post.apiDoc = {
    summary: 'ログインユーザーの追加',
    tags: ['auth'],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthCredentialOption' } } },
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthUserItem' } } },
        },
        400: { description: '入力が不正' },
        default: { description: '失敗' },
    },
};
