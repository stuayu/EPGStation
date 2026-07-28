import { Operation } from 'express-openapi';
import ISeriesMappingApiModel from '../../../../api/series/ISeriesMappingApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMappingApiModel>('ISeriesMappingApiModel');
        api.responseJSON(res, 200, await model.updateBulk(req.body ?? {}));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody' || message === 'TooManyItems')
            api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: '話数・放送種別の一括更新',
    tags: ['series'],
    description:
        'シリーズは既存の割当を引き継ぎ、指定した項目 (話数 / シーズン / 放送種別) だけを更新する。1 件失敗しても残りは反映され、失敗分は failed に入る',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/BulkUpdateSeriesMappingOption' },
            },
        },
    },
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/BulkUpdateSeriesMappingResult' } },
            },
        },
        400: { description: '不正なリクエスト' },
        default: { description: '失敗' },
    },
};
