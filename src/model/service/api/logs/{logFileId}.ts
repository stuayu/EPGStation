import { Operation } from 'express-openapi';
import ILogApiModel from '../../../api/log/ILogApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const logApiModel = container.get<ILogApiModel>('ILogApiModel');

    try {
        const content = await logApiModel.getContent(<string>req.params.logFileId, {
            lines: typeof req.query.lines === 'undefined' ? undefined : parseInt(<string>req.query.lines, 10),
            keyword: typeof req.query.keyword === 'undefined' ? undefined : <string>req.query.keyword,
        });

        if (content === null) {
            api.responseError(res, {
                code: 404,
                message: 'log file is not Found',
            });
        } else {
            api.responseJSON(res, 200, content);
        }
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ログ内容取得',
    tags: ['logs'],
    description: '指定したログファイルの内容を末尾から取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathLogFileId',
        },
        {
            $ref: '#/components/parameters/LogLines',
        },
        {
            $ref: '#/components/parameters/LogKeyword',
        },
    ],
    responses: {
        200: {
            description: 'ログ内容を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/LogFileContent',
                    },
                },
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
