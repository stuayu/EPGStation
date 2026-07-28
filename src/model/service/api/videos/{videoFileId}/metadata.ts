import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const metadata = await videoApiModel.getMetadata(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
        );
        api.responseJSON(res, 200, metadata);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画ファイルのメタデータ取得',
    tags: ['videos'],
    description: '録画ファイルの実測メタデータを取得する (未解析の場合はその場で解析する)',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'メタデータを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoFileMetadataResult',
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
        const metadata = await videoApiModel.analyzeMetadata(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
        );
        api.responseJSON(res, 200, metadata);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

post.apiDoc = {
    summary: '録画ファイルのメタデータ再解析',
    tags: ['videos'],
    description: '録画ファイルを ffprobe で解析し直して DB に保存する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'メタデータを解析しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoFileMetadataResult',
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
