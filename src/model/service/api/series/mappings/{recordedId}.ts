import { Operation } from 'express-openapi';
import ISeriesMappingApiModel from '../../../../api/series/ISeriesMappingApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
const model = () => container.get<ISeriesMappingApiModel>('ISeriesMappingApiModel');
const id = (value: string) => api.parseRequestParamInt(value, 'recordedId');
const fail = (res: any, e: unknown) => {
    const message = api.getErrorMessage(e);
    if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
    else if (message === 'RecordedIsNotFound' || message === 'SeriesIsNotFound')
        api.responseError(res, { code: 404, message });
    else if (message === 'InvalidRequestBody' || message.startsWith('Invalid'))
        api.responseError(res, { code: 400, message });
    else api.responseServerError(res, message);
};
export const get: Operation = async (req, res) => {
    try {
        const value = await model().get(id(String(req.params.recordedId)));
        if (value) api.responseJSON(res, 200, value);
        else api.responseError(res, { code: 404, message: 'mapping is not found' });
    } catch (e) {
        fail(res, e);
    }
};
export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, await model().update(id(String(req.params.recordedId)), req.body));
    } catch (e) {
        fail(res, e);
    }
};
export const del: Operation = async (req, res) => {
    try {
        await model().remove(id(String(req.params.recordedId)));
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        fail(res, e);
    }
};
get.apiDoc = {
    summary: 'シリーズ割当取得',
    tags: ['series'],
    responses: { 200: { description: '成功' }, 404: { description: '未割当' }, default: { description: '失敗' } },
};
put.apiDoc = {
    summary: 'シリーズ手動割当',
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
        404: { description: '録画/シリーズが見つからない' },
        default: { description: '失敗' },
    },
};
del.apiDoc = {
    summary: 'シリーズ割当解除',
    tags: ['series'],
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
