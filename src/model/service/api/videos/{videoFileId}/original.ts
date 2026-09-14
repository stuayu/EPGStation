import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

/** MPEG-2 MPEG-TS の録画を Range 対応のまま mpeg2toh264 へ渡す。 */
export const get: Operation = async (req, res) => {
    try {
        const info = await container
            .get<IVideoApiModel>('IVideoApiModel')
            .getOriginalMpeg2FilePath(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        if (info === null) {
            api.responseError(res, { code: 404, message: 'MPEG-2 TS video file is not found' });
            return;
        }
        api.responseFile(req, res, info.path, 'video/mp2t', false);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画 MPEG-2 オリジナルストリーム',
    tags: ['videos'],
    description: 'MPEG-2 映像の録画 MPEG-TS を Range 対応で直接返す。MPEG-4 等の非TS encoded は対象外。',
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: { description: '録画 MPEG-2 TS', content: { 'video/mp2t': {} } },
        404: { description: 'MPEG-2 TS が存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
