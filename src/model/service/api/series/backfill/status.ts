import { Operation } from 'express-openapi';
import ISeriesBackfillApiModel from '../../../../api/series/ISeriesBackfillApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<ISeriesBackfillApiModel>('ISeriesBackfillApiModel');
        api.responseJSON(res, 200, await model.getStatus());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: 'シリーズ化バックフィルの進捗状況を取得',
    tags: ['series'],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SeriesBackfillResult',
                    },
                },
            },
        },
        404: {
            description: '機能が無効',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
