import { Operation } from 'express-openapi';
import ISeriesPendingApiModel from '../../../../api/series/ISeriesPendingApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
const model = () => container.get<ISeriesPendingApiModel>('ISeriesPendingApiModel');
const id = (value: string) => api.parseRequestParamInt(value, 'pendingId');
const fail = (res: any, e: unknown) => {
    const message = api.getErrorMessage(e);
    if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
    else if (message === 'PendingMatchIsNotFound' || message === 'SeriesIsNotFound' || message === 'RecordedIsNotFound')
        api.responseError(res, { code: 404, message });
    else if (message === 'InvalidRequestBody' || message.startsWith('Invalid'))
        api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};
export const put: Operation = async (req, res) => {
    try {
        const value = await model().confirm(id(String(req.params.pendingId)), req.body);
        api.responseJSON(res, 200, value);
    } catch (e) {
        fail(res, e);
    }
};
export const del: Operation = async (req, res) => {
    try {
        await model().reject(id(String(req.params.pendingId)));
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        fail(res, e);
    }
};
put.apiDoc = {
    summary: '未確定キューを候補から確定させる',
    tags: ['series'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        seriesId: { type: 'number' },
                        seriesTitle: { type: 'string' },
                        seasonNumber: { type: 'number' },
                        episodeNumber: { type: 'number', nullable: true },
                        airType: { type: 'string', enum: ['first', 'rerun', 'delayed', 'unknown'] },
                        learnAlias: { type: 'boolean' },
                    },
                },
            },
        },
    },
    responses: {
        200: { description: '成功' },
        400: { description: '不正なリクエスト' },
        404: { description: '未検出' },
        default: { description: '失敗' },
    },
};
del.apiDoc = {
    summary: '未確定キューから除外 (この録画はシリーズ化しない)',
    tags: ['series'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
