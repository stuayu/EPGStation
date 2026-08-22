import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import ISnsApiModel from '../../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

const getModel = () => container.get<ISnsApiModel>('ISnsApiModel');

const handleError = (res: any, err: unknown): void => {
    const message = api.getErrorMessage(err);
    if (message === 'SnsAccountIsNull') {
        api.responseError(res, { code: 404, message: 'sns account is not found' });
    } else {
        api.responseServerError(res, message);
    }
};

export const put: Operation = async (req, res) => {
    try {
        const id: apid.SnsAccountId = api.parseRequestParamInt(req.params.snsAccountId, 'snsAccountId');
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        await getModel().updateAccount(userId, id, req.body);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        handleError(res, err);
    }
};

put.apiDoc = {
    summary: 'SNS 連携アカウントの更新',
    tags: ['sns'],
    description: '既定の公開範囲・チャンネル・ローカルのみを更新する (Misskey のみ有効)',
    parameters: [{ $ref: '#/components/parameters/PathSnsAccountId' }],
    requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateSnsAccountOption' } } },
        required: true,
    },
    responses: {
        200: { description: '更新に成功した' },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const del: Operation = async (req, res) => {
    try {
        const id: apid.SnsAccountId = api.parseRequestParamInt(req.params.snsAccountId, 'snsAccountId');
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        await getModel().deleteAccount(userId, id);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        handleError(res, err);
    }
};

del.apiDoc = {
    summary: 'SNS 連携の解除',
    tags: ['sns'],
    description: '連携を解除する (DB から削除する。SNS 側のアプリ連携は解除されないため必要なら利用者側で取り消す)',
    parameters: [{ $ref: '#/components/parameters/PathSnsAccountId' }],
    responses: {
        200: { description: '解除に成功した' },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
