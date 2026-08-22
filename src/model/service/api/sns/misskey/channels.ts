import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import ISnsApiModel from '../../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        const accountId: apid.SnsAccountId = api.parseRequestParamInt(String(req.query.accountId), 'accountId');
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        api.responseJSON(res, 200, await model.getMisskeyChannels(userId, accountId));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'SnsAccountIsNull') {
            api.responseError(res, { code: 404, message: 'sns account is not found' });
        } else {
            api.responseServerError(res, message);
        }
    }
};

get.apiDoc = {
    summary: 'Misskey のチャンネル一覧取得',
    tags: ['sns'],
    description: '指定した連携アカウントがフォロー中 + 作成したチャンネルの一覧を取得する (設定画面のチャンネル選択用)',
    parameters: [
        {
            name: 'accountId',
            in: 'query',
            required: true,
            schema: { $ref: '#/components/schemas/SnsAccountId' },
        },
    ],
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsMisskeyChannels' } } },
        },
        404: { description: 'アカウントが存在しない、または Misskey アカウントではない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
