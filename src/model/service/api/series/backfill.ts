import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import ISeriesBackfillApiModel from '../../../api/series/ISeriesBackfillApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesBackfillApiModel>('ISeriesBackfillApiModel');
        const option = <apid.SeriesBackfillOption>(req.body ?? {});
        api.responseJSON(res, 200, await model.start(option));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

post.apiDoc = {
    summary: '既存録画のシリーズ化バックフィルを開始',
    tags: ['series'],
    description:
        '既存録画をチャンク分割して順次シリーズ解決を行うバックグラウンドジョブを開始する。既に実行中の場合は現在の状態を返すのみで新たに開始はしない。中断後の再実行は前回の続きから再開する。dryRun を指定すると DB を変更せずマッチ結果のプレビューのみ返す',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/SeriesBackfillOption',
                },
            },
        },
        required: false,
    },
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

export const del: Operation = async (_req, res) => {
    try {
        const model = container.get<ISeriesBackfillApiModel>('ISeriesBackfillApiModel');
        await model.cancel();
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

del.apiDoc = {
    summary: '実行中のシリーズ化バックフィルをキャンセル',
    tags: ['series'],
    responses: {
        200: { description: '成功' },
        404: { description: '機能が無効' },
        default: { description: '失敗' },
    },
};
