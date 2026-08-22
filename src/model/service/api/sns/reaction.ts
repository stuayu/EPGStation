import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import container from '../../../ModelContainer';
import * as api from '../../api';

const getModel = () => container.get<ISnsApiModel>('ISnsApiModel');

const handleError = (res: any, err: unknown): void => {
    const message = api.getErrorMessage(err);
    if (message === 'SnsAccountIsNull') {
        api.responseError(res, { code: 404, message: 'sns account is not found' });
    } else {
        api.responseServerError(res, message);
    }
};

export const post: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        api.responseJSON(res, 200, await getModel().addReaction(userId, req.body));
    } catch (err: unknown) {
        handleError(res, err);
    }
};

post.apiDoc = {
    summary: 'SNS へのリアクション',
    tags: ['sns'],
    description:
        'ノートへリアクションを付ける。Misskey は絵文字リアクション (reaction 省略時は既定の絵文字)、' +
        'Bluesky は like (cid が必須)。失敗しても isSuccess: false を返すだけで例外にはしない (楽観更新の巻き戻し用)。' +
        'Bluesky で成功した場合、取り消し (DELETE) に必要な reactionKey を返す',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsReactionOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: '成功 (個々の成否は isSuccess を参照)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsReactionResult' } } },
        },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const del: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        api.responseJSON(res, 200, await getModel().removeReaction(userId, req.body));
    } catch (err: unknown) {
        handleError(res, err);
    }
};

del.apiDoc = {
    summary: 'SNS へのリアクションの取り消し',
    tags: ['sns'],
    description:
        'リアクションを取り消す。Misskey は noteId のみで取り消せる。' +
        'Bluesky は like レコードの rkey (POST 時のレスポンスの reactionKey) が必須',
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsReactionOption' } } },
        required: true,
    },
    responses: {
        200: {
            description: '成功 (個々の成否は isSuccess を参照)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsReactionResult' } } },
        },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
