import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const model = container.get<IVideoApiModel>('IVideoApiModel');
    try {
        await model.detectCm(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        api.responseJSON(res, 202, { queued: true });
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'VideoFileIsUndefined') api.responseError(res, { code: 404, message });
        else if (message === 'VideoFileIsNotTs') api.responseError(res, { code: 400, message });
        else if (message === 'CmDetectionDisabled' || message === 'VideoFileAlreadyHasChapters')
            api.responseError(res, { code: 409, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '録画 TS の CM を検出してチャプターを作成',
    tags: ['videos'],
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        202: { description: 'キューへ登録' },
        400: { description: 'TS 以外' },
        404: { description: '動画が存在しない' },
        409: { description: '機能無効または既存チャプターあり' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
