import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const fileInfo = await videoFileApiModel.getFullFilePath(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));

        if (fileInfo === null) {
            api.responseError(res, {
                code: 404,
                message: 'video file is not found',
            });
        } else {
            api.responseFile(req, res, fileInfo.path, fileInfo.mime, req.query.isDownload as any as boolean);
        }
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ビデオファイル',
    tags: ['videos'],
    description: 'ビデオファイルを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/IsDownload',
        },
    ],
    responses: {
        200: {
            description: 'ビデオファイルを取得しました',
            content: {
                'video/mp2t': {},
                'video/mp4': {},
                'video/x-matroska': {},
                'video/webm': {},
                'application/octet-stream': {},
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

export const del: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        await videoFileApiModel.deleteVideoFile(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

del.apiDoc = {
    summary: 'ビデオファイル',
    tags: ['videos'],
    description: 'ビデオファイルを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'ビデオファイルを削除しました',
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
