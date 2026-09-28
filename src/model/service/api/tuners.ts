import { Operation } from 'express-openapi';
import ITunerApiModel from '../../api/tuner/ITunerApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<ITunerApiModel>('ITunerApiModel');
        api.responseJSON(res, 200, await model.gets());
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'チューナー一覧取得',
    tags: ['tuners'],
    description: 'Mirakurun が保持するチューナー名・種別・使用状態を取得する',
    responses: {
        200: {
            description: 'チューナー一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TunerItems' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
