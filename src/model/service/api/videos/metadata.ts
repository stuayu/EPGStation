import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const status = await videoApiModel.getMetadataStatus();
        api.responseJSON(res, 200, status);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画ファイルメタデータの解析状況取得',
    tags: ['videos'],
    description: '録画ファイルの ffprobe メタデータ解析状況を取得する',
    responses: {
        200: {
            description: '解析状況を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoFileMetadataStatus',
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

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;
        const result = await videoApiModel.analyzeAllMetadata(limit);
        api.responseJSON(res, 200, result);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

post.apiDoc = {
    summary: '録画ファイルメタデータの一括解析',
    tags: ['videos'],
    description: '未解析の録画ファイルを ffprobe でまとめて解析して DB に保存する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AnalyzeVideoFilesOption',
                },
            },
        },
        required: false,
    },
    responses: {
        200: {
            description: '一括解析を実行しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AnalyzeVideoFilesResult',
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
