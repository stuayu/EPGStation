import { Operation } from 'express-openapi';
import IAuthModel from '../../../auth/IAuthModel';
import { setSessionCookie } from '../../../auth/SessionCookie';
import IConfiguration from '../../../IConfiguration';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        const body = req.body ?? {};
        const result = await model.setup(String(body.name ?? ''), String(body.password ?? ''));
        setSessionCookie(
            res,
            result.token,
            result.maxAgeSec,
            api.getCookiePath(container.get<IConfiguration>('IConfiguration')),
        );
        api.responseJSON(res, 200, { user: { id: result.user.id, name: result.user.name } });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'AuthIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'AuthIsAlreadyInitialized') api.responseError(res, { code: 409, message });
        else if (
            message === 'InvalidUserName' ||
            message === 'PasswordIsTooShort' ||
            message === 'PasswordIsTooLong' ||
            message === 'InvalidPassword' ||
            message === 'UserNameIsAlreadyUsed'
        )
            api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '初期ユーザーの作成',
    tags: ['auth'],
    description: 'ユーザーが 1 人も居ないときだけ実行できる。作成後そのままログイン状態になる (認証不要)',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthCredentialOption' } } },
    },
    responses: {
        200: { description: '作成しました' },
        400: { description: '入力が不正' },
        404: { description: '認証が無効' },
        409: { description: 'すでに初期化済み' },
        default: { description: '失敗' },
    },
};
