import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        api.responseJSON(res, 200, await model.reanalyze(req.body));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled' || message === 'SeriesIsNotFound') {
            api.responseError(res, { code: 404, message });
        } else if (message === 'InvalidRequestBody' || message === 'TooManySeries') {
            api.responseError(res, { code: 400, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: '選択したシリーズをまとめて再解析',
    tags: ['series'],
    description:
        '指定したシリーズのメタデータ (表示名・クール・総話数・外部 ID・作品コメント) を作品辞書から引き直し、' +
        '続けてそのシリーズにリンク済みの録画をすべてシリーズ判定にかけ直す (話数・サブタイトル・放送種別の付け直し)。' +
        '手動確定 (manualLock) 済みの録画は対象外。' +
        '録画の再判定はバックグラウンドで進むため、進捗は GET /api/series/backfill/status で追う。' +
        '一時的な部分実行なので、全件バックフィルの再開カーソルには影響しない',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ReanalyzeSeriesOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: '成功',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ReanalyzeSeriesResult',
                    },
                },
            },
        },
        400: {
            description: 'リクエストが不正',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
        404: {
            description: '機能が無効、またはシリーズが存在しない',
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
