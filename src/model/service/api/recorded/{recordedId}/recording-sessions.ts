import { Operation } from 'express-openapi';
import IRecordingSessionApiModel from '../../../../api/recorded/IRecordingSessionApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IRecordingSessionApiModel>('IRecordingSessionApiModel');
        const result = await model.getByRecordedId(api.parseRequestParamInt(req.params.recordedId, 'recordedId'));
        api.responseJSON(res, 200, result);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画セッションと接続試行を取得',
    tags: ['recorded'],
    description: '指定録画に紐づくセッションと上流接続試行を取得する',
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: {
            description: '録画セッション一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordingSessions' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
