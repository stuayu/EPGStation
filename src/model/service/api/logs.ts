import { Operation } from 'express-openapi';
import ILogApiModel from '../../api/log/ILogApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    const logApiModel = container.get<ILogApiModel>('ILogApiModel');

    try {
        api.responseJSON(res, 200, await logApiModel.getFiles());
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ログファイル一覧取得',
    tags: ['logs'],
    description: '出力されているログファイルの一覧を取得する',
    responses: {
        200: {
            description: 'ログファイル一覧を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/LogFiles',
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
