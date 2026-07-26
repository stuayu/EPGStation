import { Operation } from 'express-openapi';
import IProgramSeriesApiModel from '../../../api/schedule/IProgramSeriesApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await container.get<IProgramSeriesApiModel>('IProgramSeriesApiModel').metrics());
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: '番組⇄シリーズ事前マッピングの精度メトリクス取得 (§4.10)',
    tags: ['series'],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/ProgramSeriesMetrics' },
                },
            },
        },
        default: { description: '失敗' },
    },
};
