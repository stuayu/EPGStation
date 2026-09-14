import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

/** MPEG-2 TS を mpeg2toh264 用に直接配信する。 */
export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');
    let result: { streamId: number; stream: NodeJS.ReadableStream } | undefined;
    let stopped = false;
    let requestClosed: boolean = false;
    let keepTimer: ReturnType<typeof setInterval> | undefined;
    const stop = async (): Promise<void> => {
        clearInterval(keepTimer);
        if (result === undefined || stopped === true) return;
        stopped = true;
        await streamApiModel.stop(result.streamId, true);
    };

    res.on('close', () => {
        requestClosed = true;
        if (res.writableEnded !== true) void stop().catch(() => undefined);
    });

    try {
        result = await streamApiModel.startLiveOriginalMpeg2Stream({
            channelId: api.parseRequestParamInt(req.params.channelId, 'channelId'),
        });
        // ライブ配信は StreamBaseModel の停止タイマー (15 秒) で keep されないと止まる。
        // m2tsll と同じく配信中はサーバ側で keep し続ける (無いと 15 秒で配信が切れ、再生が戻らない)
        const streamId = result.streamId;
        keepTimer = setInterval(() => {
            try {
                streamApiModel.keep(streamId);
            } catch {
                clearInterval(keepTimer);
            }
        }, 10 * 1000);
        if (requestClosed) {
            await stop();
            return;
        }
    } catch (err: unknown) {
        api.responseStreamStartError(res, err);
        return;
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.status(200);
    const end = (): void => {
        clearInterval(keepTimer);
        res.end();
    };
    result.stream.on('close', end);
    result.stream.on('end', end);
    result.stream.on('error', end);
    result.stream.pipe(res);
};

get.apiDoc = {
    summary: 'ライブ MPEG-2 オリジナルストリーム',
    tags: ['streams'],
    description: 'tsreadex のみを通した MPEG-2 TS を mpeg2toh264 用に直接配信する。',
    parameters: [{ $ref: '#/components/parameters/PathChannelId' }],
    responses: {
        200: { description: 'ライブ MPEG-2 TS ストリーム', content: { 'video/mp2t': {} } },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
