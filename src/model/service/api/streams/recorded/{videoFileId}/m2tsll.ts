import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
import { normalizeStreamPlayPosition } from '../../../../../../util/StreamPlayPosition';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed = false;
    let result: StreamResponse;
    let keepTimer: ReturnType<typeof setInterval> | undefined;
    let isStopped = false;

    const stop = async (): Promise<void> => {
        if (typeof keepTimer !== 'undefined') clearInterval(keepTimer);
        if (typeof result === 'undefined' || isStopped === true) return;
        isStopped = true;
        await streamApiModel.stop(result.streamId, true);
    };

    // GET リクエスト本文の受信完了でも req.close が発火し得るため、出力レスポンス側で切断を監視する。
    res.on('close', async () => {
        if (res.writableEnded === true) return;
        isClosed = true;
        await stop();
    });
    // stdout の EOF 後にレスポンスが完了したら、keep タイマーを止めてサーバー側も回収する。
    // EOF 前の切断は上の close が停止する。正常終了時の process exit ではここまで待つ。
    res.once('finish', () => {
        void stop().catch(() => undefined);
    });

    const streamOption = api.parseStreamModeOrProfile(req, res);
    if (streamOption === null) return;

    try {
        result = await streamApiModel.startRecordedM2TsLLStream({
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
                if (typeof keepTimer !== 'undefined') clearInterval(keepTimer);
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

    res.setHeader('Content-Type', 'video/mp2t');
    res.status(200);
    result.stream.on('close', () => res.end());
    result.stream.on('exit', () => res.end());
    result.stream.on('error', () => res.end());
    result.stream.pipe(res);
};

get.apiDoc = {
    summary: '録画 M2TS-LL ストリーム',
    tags: ['streams'],
    description: '録画ファイルを mpegts.js 向け低遅延 MPEG-TS として取得する。ファイルへ保存せず stdout を直接配信する',
    parameters: [
        { $ref: '#/components/parameters/PathVideoFileId' },
        { $ref: '#/components/parameters/StreamPlayPosition' },
        { $ref: '#/components/parameters/StreamMode' },
        { $ref: '#/components/parameters/StreamProfile' },
        { $ref: '#/components/parameters/StreamAudioTrack' },
    ],
    responses: {
        200: {
            description: '録画 M2TS-LL ストリーム',
            content: { 'video/mp2t': {} },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
        },
    },
};
