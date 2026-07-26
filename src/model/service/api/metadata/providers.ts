import { Operation } from 'express-openapi';
import IMetadataService from '../../../metadata/IMetadataService';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, { providers: container.get<IMetadataService>('IMetadataService').providers() });
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};
get.apiDoc = {
    summary: 'メタデータプロバイダー一覧',
    tags: ['metadata'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
