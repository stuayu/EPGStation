import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const chapters = await videoFileApiModel.getChapters(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
        );
        api.responseJSON(res, 200, {
            chapters: chapters,
        });
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'VideoFileIsUndefined') {
            api.responseError(res, { code: 404, message: message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

get.apiDoc = {
    summary: '録画ファイルのチャプター',
    tags: ['videos'],
    description:
        '録画ファイルに埋め込まれたチャプターを取得する。要求のたびに ffprobe で読み出すため DB には保存されない。チャプターが無いファイルでは空配列を返す',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'チャプターを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoChapters',
                    },
                },
            },
        },
        404: {
            description: '指定された録画ファイルが存在しません',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
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
