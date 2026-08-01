import { Operation } from 'express-openapi';
import ISeriesBackfillApiModel from '../../../../api/series/ISeriesBackfillApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesBackfillApiModel>('ISeriesBackfillApiModel');
        const recordedId = api.parseRequestParamInt(req.params.recordedId, 'recordedId');
        api.responseJSON(res, 200, await model.analyze(recordedId));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled' || message === 'RecordedIsNotFound') {
            api.responseError(res, { code: 404, message: message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: '録画 1 件のシリーズ判定を実行',
    tags: ['series'],
    description:
        '指定した録画 1 件だけシリーズ判定 (放送予定照会 → エイリアス辞書 → 作品辞書 → LLM → 類似度) を実行し、' +
        '各ステップへ何を投げて何が返ったかのトレース付きで結果を返す。バックフィルの再開カーソルには影響しない',
    parameters: [
        {
            name: 'recordedId',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
        },
    ],
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SeriesAnalyzeResult',
                    },
                },
            },
        },
        404: {
            description: '機能が無効、または録画が存在しない',
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
