import { Operation } from 'express-openapi';
import INotificationDispatcher from '../../../../../notification/INotificationDispatcher';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const get: Operation = async (req, res) => {
    try {
        const d = container.get<INotificationDispatcher>('INotificationDispatcher');
        const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
        api.responseJSON(res, 200, await d.getFailureHistory(limit));
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: '通知の失敗履歴取得 (リトライ上限に達し送信を断念したもの)',
    tags: ['settings'],
    parameters: [
        {
            description: '取得件数上限',
            in: 'query',
            name: 'limit',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200 },
        },
    ],
    responses: {
        200: {
            description: '失敗履歴一覧',
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/NotificationFailureHistoryItem' },
                    },
                },
            },
        },
        default: { description: 'error' },
    },
};
