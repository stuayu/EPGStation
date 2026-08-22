import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        api.responseJSON(res, 200, await model.getAccounts(userId));
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'SNS 連携アカウント一覧の取得',
    tags: ['sns'],
    description:
        'ログインユーザーの SNS (Bluesky / Misskey) 連携アカウント一覧を取得する (credential は含めない)。認証無効・匿名時は共有枠のアカウントを返す',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsAccountItems' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
