import { Operation } from 'express-openapi';
import IAuthModel from '../../auth/IAuthModel';
import { SESSION_COOKIE_NAME } from '../../auth/SessionCookie';
import { readCookie } from '../../auth/SessionToken';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        api.responseJSON(res, 200, await model.getStatus(token));
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};

get.apiDoc = {
    summary: '認証状態の取得',
    tags: ['auth'],
    description: '認証が有効か / 初期ユーザーが作成済みか / ログイン中のユーザーを返す (認証不要)',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthStatus' } } },
        },
        default: { description: '失敗' },
    },
};
