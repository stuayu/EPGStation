import { Operation } from 'express-openapi';
import IAuthModel from '../../../auth/IAuthModel';
import { SESSION_COOKIE_NAME } from '../../../auth/SessionCookie';
import { readCookie } from '../../../auth/SessionToken';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IAuthModel>('IAuthModel');
        if (model.isEnabled() === false) {
            // 認証が無効ならトークンは不要
            api.responseJSON(res, 200, { token: null });

            return;
        }

        const payload = await model.verify(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
        if (payload === null) {
            api.responseError(res, { code: 401, message: 'Unauthorized' });

            return;
        }

        api.responseJSON(res, 200, { token: model.createMediaToken(payload) });
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};

get.apiDoc = {
    summary: '外部プレイヤー用アクセストークンの取得',
    tags: ['auth'],
    description:
        'VLC / Infuse などの外部プレイヤーや IPTV クライアントは Cookie を送れないため、動画配信 URL のクエリに付けるトークンを発行する',
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['token'],
                        properties: { token: { type: 'string', nullable: true } },
                    },
                },
            },
        },
        401: { description: '未ログイン' },
        default: { description: '失敗' },
    },
};
