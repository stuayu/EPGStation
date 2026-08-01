import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        await model.updateMetadata(api.parseRequestParamInt(req.params.seriesId, 'seriesId'), req.body ?? {});
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};

put.apiDoc = {
    summary: 'シリーズのメタデータ手動設定',
    tags: ['series'],
    description:
        'シリーズ名・クール・読み仮名・総話数・作品コメントを手動で設定する。作品辞書にも録画からの推測にも頼れない作品向け。' +
        'シリーズ名・クール・コメントを設定した場合は以降の自動補完で上書きされない (コメントは null / 空文字で削除)。' +
        'シリーズ名を変えても引き当てキー (正規化タイトル) は変わらないため、既存の紐付けや自動判定には影響しない',
    parameters: [{ name: 'seriesId', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        title: { type: 'string', nullable: true, minLength: 1, maxLength: 500 },
                        titleKana: { type: 'string', nullable: true, maxLength: 500 },
                        seasonYear: { type: 'integer', nullable: true, minimum: 1950, maximum: 2200 },
                        seasonName: {
                            type: 'string',
                            nullable: true,
                            enum: ['WINTER', 'SPRING', 'SUMMER', 'AUTUMN'],
                        },
                        totalEpisodes: { type: 'integer', nullable: true, minimum: 0, maximum: 10000 },
                        comment: { type: 'string', nullable: true, maxLength: 20000 },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
