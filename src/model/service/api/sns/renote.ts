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
        api.responseJSON(res, 200, await model.renote(userId, req.body));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'SnsAccountIsNull') {
            api.responseError(res, { code: 404, message: 'sns account is not found' });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: 'SNS へのリノート',
    tags: ['sns'],
    description:
        'ノートをリノートする。Misskey は renote (本文なし)、Bluesky は repost (cid が必須)。' +
        '失敗しても isSuccess: false を返すだけで例外にはしない',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsRenoteOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: '成功 (個々の成否は isSuccess を参照)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsRenoteResult' } } },
        },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
