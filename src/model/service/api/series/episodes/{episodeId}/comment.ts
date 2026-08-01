import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const put: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        await model.updateEpisodeComment(
            api.parseRequestParamInt(req.params.episodeId, 'episodeId'),
            req.body?.comment ?? null,
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesEpisodeIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};

put.apiDoc = {
    summary: '放送回コメントの編集',
    tags: ['series'],
    description:
        'エピソードの放送回コメント (しょぼいカレンダーの ProgComment 由来) を手動で設定する。' +
        'null または空文字を渡すと削除する。手動設定した値は以降の自動取得で上書きされない',
    parameters: [{ name: 'episodeId', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { comment: { type: 'string', nullable: true, maxLength: 20000 } },
                },
            },
        },
    },
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
