import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import { getRequestBaseUrl } from '../../../../auth/RequestUrl';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        const result = await model.createMisskeyAuthSession(userId, req.body, getRequestBaseUrl(req));
        api.responseJSON(res, 200, result);
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'MisskeyInstanceUrlIsInvalid') {
            api.responseError(res, { code: 400, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: 'Misskey の MiAuth 認証セッション作成',
    tags: ['sns'],
    description:
        'インスタンス URL を受け取り、MiAuth の認証セッションを作成する。' +
        '返ってきた authUrl へブラウザを遷移させ、承認後に `/api/sns/misskey/callback` へ戻ってくる',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsMisskeyAuthOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsMisskeyAuthSession' } } },
        },
        400: { description: 'instanceUrl が不正' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
