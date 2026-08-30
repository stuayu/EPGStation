import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../../../api/thumbnail/IThumbnailApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const post: Operation = async (req, res) => {
    const model = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    try {
        const profile = req.body?.profile;
        await model.regenerateRecorded(
            api.parseRequestParamInt(req.params.recordedId, 'recordedId'),
            profile === 'fast' || profile === 'balanced' || profile === 'quality' ? profile : undefined,
        );
        api.responseJSON(res, 202, { code: 202 });
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'RecordedIsNotFound') {
            api.responseError(res, { code: 404, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: '録画サムネイル再生成',
    tags: ['thumbnails'],
    description: '指定録画のサムネイルを削除して非同期再生成する',
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    requestBody: {
        required: false,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: { profile: { type: 'string', enum: ['fast', 'balanced', 'quality'] } },
                },
            },
        },
    },
    responses: {
        202: { description: '再生成を開始しました' },
        404: { description: '録画が見つかりません' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
