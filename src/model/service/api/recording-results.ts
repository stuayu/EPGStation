import { Operation } from 'express-openapi';
import IRecordingSessionApiModel from '../../api/recorded/IRecordingSessionApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IRecordingSessionApiModel>('IRecordingSessionApiModel');
        const query = req.query as unknown as import('../../../../api').RecordingResultQuery;
        api.responseJSON(
            res,
            200,
            await model.getRecordingResults({
                ...query,
                offset: query.offset ?? 0,
                limit: query.limit ?? 50,
            }),
        );
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: '録画結果一覧を取得',
    tags: ['recording'],
    description: '録画セッションの結果を条件で絞り込み、予定時刻の降順で取得する',
    parameters: [
        {
            name: 'result',
            in: 'query',
            schema: { type: 'string', enum: ['completed', 'partial', 'failed', 'canceled'] },
        },
        { name: 'from', in: 'query', schema: { $ref: '#/components/schemas/UnixtimeMS' } },
        { name: 'to', in: 'query', schema: { $ref: '#/components/schemas/UnixtimeMS' } },
        { name: 'ruleId', in: 'query', schema: { $ref: '#/components/schemas/RuleId' } },
        { name: 'keyword', in: 'query', schema: { type: 'string' } },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    ],
    responses: {
        200: {
            description: '録画結果一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordingResultList' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
