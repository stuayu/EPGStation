import { Operation } from 'express-openapi';
import IAnnictProvider from '../../../../../metadata/annict/IAnnictProvider';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (_req, res) => {
    try {
        const provider = container.get<IAnnictProvider>('IAnnictProvider');
        if (typeof provider.testConnection !== 'function') {
            api.responseError(res, { code: 501, message: 'AnnictConnectionTestIsNotSupported' });
            return;
        }
        const result = await provider.testConnection();
        api.responseJSON(res, 200, result);
    } catch (e) {
        api.responseError(res, { code: 400, message: api.getErrorMessage(e) });
    }
};
post.apiDoc = {
    summary: 'Annict 接続テスト',
    tags: ['settings'],
    requestBody: {
        content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
    responses: {
        200: {
            description: '結果',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnnictConnectionTestResult' } } },
        },
        default: { description: '失敗' },
    },
};
