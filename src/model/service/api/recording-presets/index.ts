import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IRecordingPresetApiModel from '../../../api/recordingPreset/IRecordingPresetApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const model = () => container.get<IRecordingPresetApiModel>('IRecordingPresetApiModel');
const error = (res: any, e: unknown): void => {
    const message = api.getErrorMessage(e);
    if (message === 'RecordingPresetIsNotFound') api.responseError(res, { code: 404, message });
    else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await model().gets());
    } catch (e) {
        error(res, e);
    }
};
get.apiDoc = {
    summary: '録画プリセット一覧取得',
    tags: ['recording-presets'],
    responses: {
        200: {
            description: '一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordingPresetItems' } } },
        },
    },
};

export const post: Operation = async (req, res) => {
    try {
        const id = await model().create(req.body as apid.AddRecordingPresetOption);
        api.responseJSON(res, 200, { presetId: id });
    } catch (e) {
        error(res, e);
    }
};
post.apiDoc = {
    summary: '録画プリセット作成',
    tags: ['recording-presets'],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AddRecordingPresetOption' } } },
    },
    responses: {
        200: {
            description: '作成成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AddedRecordingPreset' } } },
        },
    },
};
