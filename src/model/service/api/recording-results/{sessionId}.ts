import { Operation } from 'express-openapi';
import IRecordingSessionApiModel from '../../../api/recorded/IRecordingSessionApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IRecordingSessionApiModel>('IRecordingSessionApiModel');
        const result = await model.getRecordingResultDetail(
            api.parseRequestParamInt(req.params.sessionId, 'sessionId'),
        );
        if (result === null) {
            api.responseError(res, { code: 404, message: 'RecordingSessionIsNotFound' });
            return;
        }
        api.responseJSON(res, 200, result);
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画結果と接続試行を取得',
    tags: ['recording'],
    description: '録画セッションと上流接続試行を取得する',
    parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: {
        200: {
            description: '録画結果詳細',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordingResultDetail' } } },
        },
        404: { description: '録画セッションが存在しない' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
