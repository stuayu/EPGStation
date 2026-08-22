import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import ISnsApiModel from '../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    try {
        const accountId: apid.SnsAccountId = api.parseRequestParamInt(String(req.query.accountId), 'accountId');
        const type = typeof req.query.type === 'string' ? (req.query.type as apid.SnsTimelineType) : undefined;
        const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : undefined;
        const limit = typeof req.query.limit !== 'undefined' ? parseInt(req.query.limit as any, 10) : undefined;
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<ISnsApiModel>('ISnsApiModel');
        api.responseJSON(res, 200, await model.getTimeline(userId, accountId, type, channelId, limit, cursor));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'SnsAccountIsNull') {
            api.responseError(res, { code: 404, message: 'sns account is not found' });
        } else if (message === 'SnsTimelineChannelIdIsRequired' || message === 'SnsAccountInstanceUrlIsNull') {
            api.responseError(res, { code: 400, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

get.apiDoc = {
    summary: 'SNS タイムラインの取得',
    tags: ['sns'],
    description:
        '指定した連携アカウントのタイムラインを provider の差を吸収した共通形で取得する。' +
        'Misskey は type (home/social/local/channel) を切り替えられる。Bluesky は常に本人のホームタイムラインを返し、type / channelId は無視される',
    parameters: [
        {
            name: 'accountId',
            in: 'query',
            required: true,
            schema: { $ref: '#/components/schemas/SnsAccountId' },
        },
        {
            name: 'type',
            in: 'query',
            required: false,
            schema: { $ref: '#/components/schemas/SnsTimelineType' },
        },
        {
            name: 'channelId',
            in: 'query',
            required: false,
            description: "type: 'channel' のとき必須 (Misskey のみ)",
            schema: { type: 'string' },
        },
        {
            name: 'limit',
            in: 'query',
            required: false,
            description: '既定 20、上限 50',
            schema: { type: 'integer' },
        },
        {
            name: 'cursor',
            in: 'query',
            required: false,
            description: '前回のレスポンスの cursor',
            schema: { type: 'string' },
        },
    ],
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SnsTimeline' } } },
        },
        400: { description: 'channelId が必要なのに指定されていない、またはアカウントの instanceUrl が不正' },
        404: { description: 'アカウントが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
