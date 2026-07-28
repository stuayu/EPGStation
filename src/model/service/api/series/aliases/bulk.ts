import { Operation } from 'express-openapi';
import ISeriesAliasApiModel from '../../../../api/series/ISeriesAliasApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesAliasApiModel>('ISeriesAliasApiModel');
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
    summary: 'シリーズエイリアスの一括編集',
    tags: ['series'],
    description:
        '複数のエイリアスをまとめて付け替え / 削除する。付け替えたものは手動修正扱いになる。1 件失敗しても残りは反映され、失敗分は failed に入る',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/BulkUpdateSeriesAliasOption' } } },
    },
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/BulkUpdateSeriesAliasResult' } },
            },
        },
        400: { description: '不正なリクエスト' },
        default: { description: '失敗' },
    },
};
