import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../../api/stream/IStreamApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    const streamOption = api.parseStreamModeOrProfile(req, res);
    if (streamOption === null) {
        return;
    }

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        const playlist = await streamApiModel.getLiveM2TsStreamM3u8(req.headers.host, api.isSecureProtocol(req), {
            channelId: api.parseRequestParamInt(req.params.channelId, 'channelId'),
            mode: streamOption.mode,
            profile: streamOption.profile,
        });

        if (playlist === null) {
            api.responseError(res, {
                code: 404,
                message: 'play list is not found',
            });
        } else {
            api.responsePlayList(req, res, playlist);
        }
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'ライブ M2TS ストリームプレイリスト',
    tags: ['streams'],
    description: 'ライブ M2TS ストリームプレイリストを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
        {
            $ref: '#/components/parameters/StreamProfile',
        },
    ],
    responses: {
        200: {
            description: 'ライブ M2TS ストリームプレイリストを取得しました',
            content: {
                'application/x-mpegURL': {},
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
