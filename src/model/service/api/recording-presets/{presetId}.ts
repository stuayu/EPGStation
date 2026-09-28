import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IRecordingPresetApiModel from '../../../api/recordingPreset/IRecordingPresetApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const model = () => container.get<IRecordingPresetApiModel>('IRecordingPresetApiModel');
const handleError = (res: any, e: unknown): void => {
    const message = api.getErrorMessage(e);
    if (message === 'RecordingPresetIsNotFound') api.responseError(res, { code: 404, message });
    else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, await model().get(api.parseRequestParamInt(req.params.presetId, 'presetId')));
    } catch (e) {
        handleError(res, e);
    }
};
get.apiDoc = {
    summary: '録画プリセット取得',
    tags: ['recording-presets'],
    parameters: [{ $ref: '#/components/parameters/PathRecordingPresetId' }],
    responses: {
        200: {
            description: 'プリセット',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordingPresetItem' } } },
        },
    },
};

export const put: Operation = async (req, res) => {
    try {
        await model().update(
            api.parseRequestParamInt(req.params.presetId, 'presetId'),
            req.body as apid.UpdateRecordingPresetOption,
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        handleError(res, e);
    }
};
put.apiDoc = {
    summary: '録画プリセット更新',
    tags: ['recording-presets'],
    parameters: [{ $ref: '#/components/parameters/PathRecordingPresetId' }],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateRecordingPresetOption' } } },
    },
    responses: { 200: { description: '更新成功' } },
};

export const delete_: Operation = async (req, res) => {
    try {
        await model().delete(api.parseRequestParamInt(req.params.presetId, 'presetId'));
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        handleError(res, e);
    }
};
// express-openapi obtains DELETE from the named export.
export { delete_ as delete };
delete_.apiDoc = {
    summary: '録画プリセット削除',
    tags: ['recording-presets'],
    parameters: [{ $ref: '#/components/parameters/PathRecordingPresetId' }],
    responses: { 200: { description: '削除成功' } },
};
