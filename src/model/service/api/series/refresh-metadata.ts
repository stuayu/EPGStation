import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const seriesId = (req.body as { seriesId?: number } | undefined)?.seriesId;
        api.responseJSON(res, 200, await model.refreshMetadata(seriesId));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesIsNotFound') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: 'シリーズのメタデータ再取得',
    tags: ['series'],
    description:
        '既存シリーズのクール・読み仮名・総話数・外部 ID を作品辞書から埋め直す。' +
        '辞書の導入前に作られたシリーズや、辞書更新後の追随に使う。' +
        'seriesId を指定した場合はそのシリーズだけを対象にし、すでに埋まっている項目も辞書の値で引き直す ' +
        '(手動設定した表示名・クール・コメントは対象外)。' +
        'config.yml の seriesLlm 設定時は、辞書で引けず外部 ID が空のシリーズのみ LLM で作品名を抽出して引き直す',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        seriesId: {
                            type: 'integer',
                            description: '対象のシリーズ id (省略時は全シリーズ)',
                        },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
