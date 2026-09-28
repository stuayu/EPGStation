import { Operation } from 'express-openapi';
import IRecordingPresetApiModel from '../../../api/recordingPreset/IRecordingPresetApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<IRecordingPresetApiModel>('IRecordingPresetApiModel').getDefault(),
        );
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: '既定録画プリセット取得',
    tags: ['recording-presets'],
    responses: {
        200: {
            description: '既定プリセットまたは null',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/RecordingPresetItem', nullable: true } },
            },
        },
    },
};
