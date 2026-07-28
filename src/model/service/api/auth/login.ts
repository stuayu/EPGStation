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
        const result = await model.login(String(body.name ?? ''), String(body.password ?? ''));
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
        else if (message === 'InvalidCredentials') api.responseError(res, { code: 401, message });
        else if (message === 'SigningKeyIsNotAvailable') api.responseError(res, { code: 500, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: 'ログイン',
    tags: ['auth'],
    description: 'ユーザー名とパスワードを検証し、セッション Cookie を発行する (認証不要)',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthCredentialOption' } } },
    },
    responses: {
        200: { description: 'ログイン成功' },
        401: { description: 'ユーザー名またはパスワードが違う' },
        404: { description: '認証が無効' },
        default: { description: '失敗' },
    },
};
