import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        api.responseJSON(res, 200, await model.post(userId, req.body));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (
            message === 'SnsPostAccountIdsIsEmpty' ||
            message === 'SnsPostTooManyImages' ||
            message === 'SnsPostImageIsInvalid'
        ) {
            api.responseError(res, { code: 400, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: 'SNS への投稿',
    tags: ['sns'],
    description:
        '指定した複数の連携アカウントへ同時に投稿する。アカウントごとの結果配列を返し、' +
        '片方が失敗しても他方の結果は残す。認証有効時は自分以外のアカウントを指定すると当該アカウントの結果が失敗になる',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsPostOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: '成功 (個々のアカウントの成否は results を参照)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsPostResult' } } },
        },
        400: { description: 'リクエストが不正 (accountIds が空 / 画像が多すぎる / 画像が不正)' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
