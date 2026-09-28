import { Operation } from 'express-openapi';
import IPowerApiModel from '../../../api/power/IPowerApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    try {
        await container.get<IPowerApiModel>('IPowerApiModel').cancel();
        api.responseJSON(res, 200, { canceled: true });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

post.apiDoc = {
    summary: '休止予定を取り消す',
    tags: ['power'],
    responses: {
        200: {
            description: '休止予定を取り消しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PowerCancelResponse' } } },
        },
    },
};
