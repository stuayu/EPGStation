import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const tracks = await videoFileApiModel.getAudioTracks(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
        );
        api.responseJSON(res, 200, {
            tracks: tracks,
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
    summary: '録画ファイルの音声トラック一覧',
    tags: ['videos'],
    description:
        '録画ファイルの音声トラック一覧を取得する。完了済み録画はファイル全体、録画中は現在存在する範囲を probe する。音声 ES が 1 つだけの AAC 2ch は main/sub へ実デコードして判定し、実際にデュアルモノラルの場合だけ主音声・副音声の 2 件へ展開する。通常ステレオ・判定不能は 1 件のまま返す。返ってきた track の値をストリーム API の audioTrack へ渡す',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '音声トラック一覧を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoAudioTracks',
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
