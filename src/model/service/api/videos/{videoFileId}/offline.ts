import { Operation } from 'express-openapi';
import IOfflineVideoApiModel from '../../../../api/video/IOfflineVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getOfflineStreamMagic } from '../../../../../util/OfflineStreamProtocol';
import { pipeOfflineRecords, writeOfflineChunk } from '../../../../../util/OfflineResponseWriter';

const MAX_METADATA_BYTES = 1024 * 1024;
export const get: Operation = async (req, res) => {
    const model = container.get<IOfflineVideoApiModel>('IOfflineVideoApiModel');
    let result: Awaited<ReturnType<IOfflineVideoApiModel['startOfflineStream']>> | null = null;
    let cleaned = false;
    let requestClosed = false;
    const cleanup = async (): Promise<void> => {
        if (cleaned === true || result === null) return;
        cleaned = true;
        await result.cleanup().catch(() => undefined);
    };
    const handleClose = (): void => {
        requestClosed = true;
        void cleanup();
    };
    const isRequestClosed = (): boolean => requestClosed;
    req.on('aborted', handleClose);
    res.on('close', handleClose);

    try {
        const rawProfile = req.query.profile;
        if (typeof rawProfile !== 'string' || rawProfile.length === 0) {
            api.responseError(res, { code: 400, message: 'profile is required' });
            return;
        }
        if (rawProfile === 'original-mpeg2') {
            const original = await model.getOriginalMpeg2FilePath(
                api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
            );
            if (original === null) {
                api.responseError(res, { code: 404, message: 'OriginalMpeg2FileIsUndefined' });
                return;
            }
            api.responseFile(req, res, original.path, 'video/mp2t', false);
            return;
        }
        const rawAudioTrack = req.query.audioTrack;
        const audioTrack = typeof rawAudioTrack === 'string' && rawAudioTrack.length > 0 ? rawAudioTrack : 'all';
        result = await model.startOfflineStream(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
            rawProfile,
            audioTrack,
        );
        if (isRequestClosed()) {
            await cleanup();
            return;
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(200);
        const metadata = Buffer.from(JSON.stringify(result.metadata), 'utf8');
        if (metadata.length > MAX_METADATA_BYTES) throw new Error('OfflineMetadataTooLarge');
        await writeOfflineChunk(res, getOfflineStreamMagic());
        const metadataLength = Buffer.allocUnsafe(4);
        metadataLength.writeUInt32BE(metadata.length, 0);
        await writeOfflineChunk(res, metadataLength);
        await writeOfflineChunk(res, metadata);

        // OfflineFmp4RecordStream が init/master/約6秒 fMP4/終端を完成順に返す。
        // ここではレコードを蓄積せず、res.write の backpressure だけを伝播する。
        await pipeOfflineRecords(res, result.stream as AsyncIterable<Buffer | string>);
        res.end();
        await cleanup();
    } catch (err: unknown) {
        await cleanup();
        if (res.headersSent === false) {
            const message = api.getErrorMessage(err);
            if (message === 'VideoFileIsUndefined' || message === 'RecordedIsUndefined') {
                api.responseError(res, { code: 404, message });
            } else if (message === 'RecordingVideoCannotBeSavedOffline') {
                api.responseError(res, { code: 409, message });
            } else if (
                message === 'OriginalMpeg2FileIsUndefined' ||
                message === 'OfflineOriginalProfileUnsupported' ||
                message === 'OfflineHlsProfileRequired' ||
                message === 'profile is required'
            ) {
                api.responseError(res, { code: 400, message });
            } else {
                api.responseServerError(res, message);
            }
        } else {
            res.destroy(err instanceof Error ? err : undefined);
        }
    }
};

get.apiDoc = {
    summary: '録画番組オフライン保存ストリーム',
    tags: ['videos'],
    description:
        '指定した HLS プロファイルで録画を fMP4 レコードへ逐次エンコードし、メタデータ・init・master・セグメント・終端を含むバイナリで返す',
    parameters: [
        { $ref: '#/components/parameters/PathVideoFileId' },
        { $ref: '#/components/parameters/PlaybackProfile' },
        { $ref: '#/components/parameters/StreamAudioTrack' },
    ],
    responses: {
        200: { description: 'オフライン保存ストリーム', content: { 'application/octet-stream': {} } },
        400: { description: 'プロファイルが不正です' },
        404: { description: '録画ファイルが存在しません' },
        409: { description: '録画中です' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
