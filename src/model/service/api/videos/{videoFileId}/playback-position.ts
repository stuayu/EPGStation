import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IWatchHistoryApiModel from '../../../../api/video/IWatchHistoryApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
const model = (): IWatchHistoryApiModel => container.get<IWatchHistoryApiModel>('IWatchHistoryApiModel');
const fail = (res: any, err: unknown): void => {
    const m = api.getErrorMessage(err);
    if (m === 'WatchHistoryFeatureIsDisabled')
        api.responseError(res, { code: 404, message: 'watch history feature is disabled' });
    else if (m === 'PlaybackPositionIsInvalid' || m === 'PlaybackDurationIsInvalid')
        api.responseError(res, { code: 400, message: m });
    else api.responseServerError(res, m);
};
export const get: Operation = async (req, res) => {
    try {
        const x = await model().get(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        if (x === null) {
            api.responseError(res, { code: 404, message: 'playback position is not found' });
        } else {
            api.responseJSON(res, 200, x);
        }
    } catch (e) {
        fail(res, e);
    }
};
get.apiDoc = {
    summary: '再生位置取得',
    tags: ['videos'],
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: {
            description: '再生位置',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WatchHistory' } } },
        },
        404: { description: '未保存または機能無効' },
        default: { description: '予期しないエラー' },
    },
};
export const put: Operation = async (req, res) => {
    try {
        const x = await model().update(
            api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'),
            req.body as apid.UpdatePlaybackPositionOption,
        );
        if (x === null) {
            api.responseError(res, { code: 404, message: 'video file is not found' });
        } else {
            api.responseJSON(res, 200, x);
        }
    } catch (e) {
        fail(res, e);
    }
};
put.apiDoc = {
    summary: '再生位置保存',
    tags: ['videos'],
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdatePlaybackPositionOption' } } },
    },
    responses: {
        200: {
            description: '保存した再生位置',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WatchHistory' } } },
        },
        400: { description: '不正な再生位置' },
        404: { description: '動画なしまたは機能無効' },
        default: { description: '予期しないエラー' },
    },
};
