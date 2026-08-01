import { Operation } from 'express-openapi';
import IWatchHistoryApiModel from '../../api/video/IWatchHistoryApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IWatchHistoryApiModel>('IWatchHistoryApiModel');
        api.responseJSON(res, 200, await model.gets(req.query as any));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'WatchHistoryFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'watch history feature is disabled' });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '視聴履歴一覧の取得',
    tags: ['watch-history'],
    description: '最後に視聴した順で視聴履歴を返す。録画が削除済みの履歴は recorded が null になる',
    parameters: [
        { $ref: '#/components/parameters/Offset' },
        { $ref: '#/components/parameters/Limit' },
        {
            name: 'status',
            in: 'query',
            description: '視聴状態で絞り込む',
            required: false,
            schema: { type: 'string', enum: ['unwatched', 'watching', 'watched'] },
        },
        { $ref: '#/components/parameters/IsHalfWidth' },
    ],
    responses: {
        200: {
            description: '視聴履歴一覧を取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WatchHistoryRecords' } } },
        },
        404: { description: '視聴履歴機能が無効' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
