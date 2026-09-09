import { Operation } from 'express-openapi';
import IScheduleApiModel from '../../../../api/schedule/IScheduleApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const tracks = await scheduleApiModel.getLiveAudioTracks(
            api.parseRequestParamInt(req.params.channelId, 'channelId'),
        );
        api.responseJSON(res, 200, {
            tracks: tracks,
        });
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ライブ視聴の音声トラック一覧',
    tags: ['channels'],
    description:
        '指定した放送局で今放送中の番組の音声トラック一覧を取得する。二か国語放送 (デュアルモノラル) は主音声・副音声の 2 件へ展開される。切り替えるものが無い場合 (通常のステレオ放送・番組情報なし) は空配列を返す。返ってきた track の値をストリーム API の audioTrack へ渡す',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
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
