import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    const streamOption = api.parseStreamModeOrProfile(req, res);
    if (streamOption === null) {
        return;
    }

    try {
        const streamId = await streamApiModel.startLiveHLSStream({
            channelId: api.parseRequestParamInt(req.params.channelId, 'channelId'),
            mode: streamOption.mode,
            profile: streamOption.profile,
        });
        api.responseJSON(res, 200, {
            streamId: streamId,
        });
    } catch (err: unknown) {
        api.responseStreamStartError(res, err);
    }
};

get.apiDoc = {
    summary: 'ライブ HLS ストリーム',
    tags: ['streams'],
    description: 'ライブ HLS ストリームを開始する',
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
            description: 'ライブ HLS ストリームを開始しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/StartStreamInfo',
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
