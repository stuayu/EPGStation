import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        api.responseJSON(res, 200, await model.loginBluesky(userId, req.body));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'SnsBlueskyLoginFailed') {
            api.responseError(res, { code: 400, message: 'bluesky login failed. check identifier / app password' });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: 'Bluesky へのログイン (App Password)',
    tags: ['sns'],
    description:
        'ハンドル (または メールアドレス) と App Password でログインし、連携アカウントとして保存する。' +
        'App Password は https://bsky.app/settings/app-passwords で発行できる',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsBlueskyLoginOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: 'ログインに成功した',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsAccountItem' } } },
        },
        400: { description: 'ログインに失敗した (identifier / appPassword が不正)' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
