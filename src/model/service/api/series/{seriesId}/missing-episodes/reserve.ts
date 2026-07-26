import { Operation } from 'express-openapi';
import IMissingEpisodeApiModel from '../../../../../api/series/IMissingEpisodeApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const post: Operation = async (req, res) => {
    try {
        const model = container.get<IMissingEpisodeApiModel>('IMissingEpisodeApiModel');
        const seriesId = api.parseRequestParamInt(String(req.params.seriesId), 'seriesId');
        const body = req.body ?? {};
        const reserveId = await model.reserveProposal(seriesId, body.seasonNumber, body.episodeNumber, body.programId);
        api.responseJSON(res, 200, { reserveId });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'ProgramIsNotFound') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: '欠番補完予約提案から予約を作成する (airType: rerun を事前付与) (§4.7)',
    tags: ['series'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['seasonNumber', 'episodeNumber', 'programId'],
                    properties: {
                        seasonNumber: { type: 'number' },
                        episodeNumber: { type: 'number' },
                        programId: { type: 'number' },
                    },
                },
            },
        },
    },
    responses: {
        200: { description: '成功' },
        404: { description: '機能無効 / シリーズ・番組が見つからない' },
        default: { description: '失敗' },
    },
};
