import { Operation } from 'express-openapi';
import INotificationDispatcher from '../../../../../notification/INotificationDispatcher';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (req, res) => {
    try {
        const d = container.get<INotificationDispatcher>('INotificationDispatcher');
        const result = await d.test(req.body?.targetName);
        if (result.failed.length === 0) {
            api.responseJSON(res, 200, result);
        } else {
            api.responseError(res, { code: 502, message: `notification failed: ${result.failed.join(',')}` });
        }
    } catch (e) {
        api.responseError(res, { code: 400, message: api.getErrorMessage(e) });
    }
};
post.apiDoc = {
    summary: '通知テスト',
    tags: ['settings'],
    requestBody: {
        content: { 'application/json': { schema: { type: 'object', properties: { targetName: { type: 'string' } } } } },
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NotificationTestResult' } } },
        },
        default: { description: '失敗' },
    },
};
