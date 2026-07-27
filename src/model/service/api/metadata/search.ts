import { Operation } from 'express-openapi';
import IMetadataService from '../../../metadata/IMetadataService';
import container from '../../../ModelContainer';
import * as api from '../../api';
export const get: Operation = async (req, res) => {
    try {
        const query = typeof req.query.query === 'string' ? req.query.query : '';
        const providers = typeof req.query.providers === 'string' ? req.query.providers.split(',') : undefined;
        const channelId = typeof req.query.channelId === 'number' ? req.query.channelId : undefined;
        const startAt = typeof req.query.startAt === 'number' ? req.query.startAt : undefined;
        const context =
            typeof channelId === 'number' || typeof startAt === 'number' ? { channelId, startAt } : undefined;
        const results = await container.get<IMetadataService>('IMetadataService').search(query, context, providers);
        api.responseJSON(res, 200, { results });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'MetadataProvidersFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'MetadataQueryIsEmpty') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '外部メタデータ検索',
    tags: ['metadata'],
    parameters: [
        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'providers', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'channelId', in: 'query', required: false, schema: { $ref: '#/components/schemas/ChannelId' } },
        { name: 'startAt', in: 'query', required: false, schema: { $ref: '#/components/schemas/UnixtimeMS' } },
    ],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/MetadataSearchResults' },
                },
            },
        },
        400: { description: '検索キーワードが空' },
        404: { description: '機能無効' },
        default: { description: '失敗' },
    },
};
