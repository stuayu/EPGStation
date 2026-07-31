import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const offset = typeof req.body?.offset === 'number' ? req.body.offset : undefined;
        const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;
        const result = await videoApiModel.reanalyzeAllTsInfo(offset, limit);
        api.responseJSON(res, 200, result);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

post.apiDoc = {
    summary: '録画ファイルの TS 強制再解析',
    tags: ['videos'],
    description:
        '解析済みかどうかに関わらず、TS ファイルの PSI/SI を offset から順に強制的に再解析して DB を上書きする。' +
        '解析ロジックの更新後に既存ファイルへ反映させたい場合に使う (未解析ファイルだけを対象にする通常の一括解析は POST /api/videos/tsinfo)',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ReanalyzeTsInfoOption',
                },
            },
        },
        required: false,
    },
    responses: {
        200: {
            description: '強制再解析を実行しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ReanalyzeTsInfoResult',
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
