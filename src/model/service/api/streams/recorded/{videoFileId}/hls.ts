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
        const streamId = await streamApiModel.startRecordedHLSStream({
            videoFileId: api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
            playPosition: parseInt(req.query.ss as string, 10),
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
    summary: '録画 HLS ストリーム',
    tags: ['streams'],
    description: '録画 HLS ストリームを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
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
            description: '録画 HLS ストリームを開始しました',
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
