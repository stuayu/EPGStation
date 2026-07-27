import { Operation } from 'express-openapi';
import IMissingEpisodeApiModel from '../../../../../api/series/IMissingEpisodeApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const get: Operation = async (req, res) => {
    try {
        const seriesId = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        const value = await container.get<IMissingEpisodeApiModel>('IMissingEpisodeApiModel').listProposals(seriesId);
        api.responseJSON(res, 200, { proposals: value });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '欠番話数の補完予約提案一覧取得 (§4.7)',
    tags: ['series'],
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MissingEpisodeProposals' } } },
        },
        404: { description: '機能無効 / シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
