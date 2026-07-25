import { Operation } from 'express-openapi';
import ILogApiModel from '../../../../api/log/ILogApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const logApiModel = container.get<ILogApiModel>('ILogApiModel');

    try {
        const filePath = await logApiModel.getFilePath(<string>req.params.logFileId);

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'log file is not Found',
            });
        } else {
            api.responseFile(req, res, filePath, 'text/plain', false);
        }
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ログファイルダウンロード',
    tags: ['logs'],
    description: '指定したログファイルをそのまま取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathLogFileId',
        },
    ],
    responses: {
        200: {
            description: 'ログファイルを取得しました',
            content: {
                'text/plain': {},
            },
        },
        404: {
            description: 'Not Found',
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
