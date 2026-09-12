import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
import { normalizeStreamPlayPosition } from '../../../../../../util/StreamPlayPosition';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: StreamResponse;
    let keepTimer: ReturnType<typeof setInterval> | undefined;
    let isStopped = false;

    const stop = async () => {
        if (typeof keepTimer !== 'undefined') clearInterval(keepTimer);

        if (typeof result === 'undefined' || isStopped === true) {
            return;
        }

        isStopped = true;
        await streamApiModel.stop(result.streamId, true);
    };

    // GET リクエスト本文の受信完了でも req.close が発火し得るため、出力レスポンス側で切断を監視する。
    res.on('close', async () => {
        if (res.writableEnded === true) return;
        isClosed = true;
        await stop();
    });
    res.once('finish', () => {
        void stop().catch(() => undefined);
    });

    const streamOption = api.parseStreamModeOrProfile(req, res);
    if (streamOption === null) {
        return;
    }

    try {
        result = await streamApiModel.startRecordedWebMStream({
            videoFileId: api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
            playPosition: normalizeStreamPlayPosition(req.query.ss),
            mode: streamOption.mode,
            profile: streamOption.profile,
            audioTrack: streamOption.audioTrack,
        });
        keepTimer = setInterval(() => {
            try {
                streamApiModel.keep(result.streamId);
            } catch {
                clearInterval(keepTimer);
            }
        }, 10 * 1000);
    } catch (err: unknown) {
        api.responseStreamStartError(res, err);

        return;
    }

    if (isClosed !== false) {
        await stop();

        return;
    }

    res.setHeader('Content-Type', 'video/webm');
    res.status(200);

    result.stream.on('close', () => {
        res.end();
    });
    result.stream.on('exit', () => {
        res.end();
    });
    result.stream.on('error', () => {
        res.end();
    });

    result.stream.pipe(res);
};

get.apiDoc = {
    summary: '録画 WebM ストリーム',
    tags: ['streams'],
    description: '録画 WebM ストリームを取得する',
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
        {
            $ref: '#/components/parameters/StreamAudioTrack',
        },
    ],
    responses: {
        200: {
            description: '録画 WebM ストリーム',
            content: {
                'video/webm': {},
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
