import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

/** MPEG-2 / HEVC MPEG-TS の録画を Range 対応のまま端末の MSE へ渡す。 */
export const get: Operation = async (req, res) => {
    try {
        const info = await container
            .get<IVideoApiModel>('IVideoApiModel')
            .getOriginalFilePath(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        if (info === null) {
            api.responseError(res, { code: 404, message: 'Original MPEG-TS video file is not found' });
            return;
        }
        api.responseFile(req, res, info.path, 'video/mp2t', false);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画 MPEG-2 / HEVC オリジナルストリーム',
    tags: ['videos'],
    description: 'MPEG-2 または HEVC 映像の録画 MPEG-TS を Range 対応で直接返す。非TS encoded は対象外。',
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: { description: '録画 MPEG-TS', content: { 'video/mp2t': {} } },
        404: { description: '直接配信可能な MPEG-TS が存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
