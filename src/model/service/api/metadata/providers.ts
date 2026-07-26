import { Operation } from 'express-openapi';
import IMetadataService from '../../../metadata/IMetadataService';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, { providers: container.get<IMetadataService>('IMetadataService').providers() });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'MetadataProvidersFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: 'メタデータプロバイダー一覧',
    tags: ['metadata'],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MetadataProviders' },
                },
            },
        },
        404: { description: '機能無効' },
        default: { description: '失敗' },
    },
};
