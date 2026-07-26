import { Operation } from 'express-openapi';
import IDashboardApiModel from '../../api/dashboard/IDashboardApiModel';
import container from '../../ModelContainer';
import * as api from '../api';
export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IDashboardApiModel>('IDashboardApiModel');
        const limit =
            typeof req.query.limit === 'number' ? req.query.limit : parseInt(String(req.query.limit ?? 5), 10);
        // isHalfWidth は省略可能 (既定 false)。express-openapi は schema に従い boolean へ型変換するため
        // 文字列比較 ('true') ではなく boolean としてそのまま扱う (他の handler と同じ流儀)
        const isHalfWidth = req.query.isHalfWidth as any as boolean | undefined;
        api.responseJSON(res, 200, await model.get(isHalfWidth === true, limit));
    } catch (e) {
        const m = api.getErrorMessage(e);
        if (m === 'DashboardFeatureIsDisabled') {
            api.responseError(res, { code: 404, message: 'dashboard feature is disabled' });
        } else {
            api.responseServerError(res, m);
        }
    }
};
get.apiDoc = {
    summary: 'ダッシュボード集約情報',
    tags: ['dashboard'],
    parameters: [{ $ref: '#/components/parameters/IsHalfWidthOptional' }, { $ref: '#/components/parameters/Limit' }],
    responses: {
        200: {
            description: 'ダッシュボード情報',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DashboardData' } } },
        },
        404: { description: '機能無効' },
        default: { description: '予期しないエラー' },
    },
};
