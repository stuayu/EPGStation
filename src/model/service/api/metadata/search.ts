import { Operation } from 'express-openapi';
import IMetadataService from '../../../metadata/IMetadataService';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const query = typeof req.query.query === 'string' ? req.query.query : '';
        const providers = typeof req.query.providers === 'string' ? req.query.providers.split(',') : undefined;
        const results = await container.get<IMetadataService>('IMetadataService').search(query, undefined, providers);
        api.responseJSON(res, 200, { results });
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: '外部メタデータ検索',
    tags: ['metadata'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
