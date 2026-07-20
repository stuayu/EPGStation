import { Operation } from 'express-openapi';
import IStatusApiModel from '../../api/status/IStatusApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    const statusApiModel = container.get<IStatusApiModel>('IStatusApiModel');

    try {
        api.responseJSON(res, 200, await statusApiModel.getStatus());
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '外部サービスとの接続状態取得',
    tags: ['status'],
    description: 'mirakurun 等の外部サービスとの接続状態を取得する',
    responses: {
        200: {
            description: '接続状態を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Status',
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
