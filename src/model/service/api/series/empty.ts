import { Operation } from 'express-openapi';
import ISeriesMaintenanceApiModel from '../../../api/series/ISeriesMaintenanceApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        api.responseJSON(res, 200, await model.listEmpty());
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '録画が 0 件のシリーズ一覧',
    tags: ['series'],
    description:
        '録画が 1 件も紐づいていないシリーズを列挙する。マージ・分割・録画削除の結果取り残された自動生成シリーズの探索に使う',
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmptySeriesListResult' } } },
        },
        404: {
            description: '機能が無効',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const del: Operation = async (req, res) => {
    try {
        const model = container.get<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel');
        const body = (req.body ?? {}) as { seriesIds?: number[] };
        const seriesIds = Array.isArray(body.seriesIds) ? body.seriesIds.map(x => Number(x)) : undefined;
        api.responseJSON(res, 200, await model.deleteEmpty(seriesIds));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'InvalidRequestBody' || message === 'SeriesIsNotEmpty')
            api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};

del.apiDoc = {
    summary: '録画が 0 件のシリーズを削除',
    tags: ['series'],
    description:
        '録画が 0 件のシリーズをエピソード・エイリアス辞書・予約ヒントごと削除する。seriesIds を省略した場合は録画 0 件のシリーズをすべて削除する。録画が紐づいているシリーズ ID が含まれている場合は 400 を返し、一件も削除しない',
    requestBody: {
        required: false,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteEmptySeriesOption' } } },
    },
    responses: {
        200: {
            description: '成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteEmptySeriesResult' } } },
        },
        400: {
            description: '不正なリクエスト',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        404: {
            description: '機能が無効',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
