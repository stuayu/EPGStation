import { Operation } from 'express-openapi';
import IPlaybackApiModel from '../../../../api/stream/IPlaybackApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { parseClientCapabilities } from '../../../../api/stream/PlaybackCapability';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IPlaybackApiModel>('IPlaybackApiModel');
        const videoFileId = api.parseRequestParamInt(req.params.videoFileId, 'videoFileId');
        const query = req.query as Record<string, unknown>;
        api.responseJSON(res, 200, await model.getRecordedPlaybackOptions(videoFileId, parseClientCapabilities(query), query.profile as string | undefined));
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'VideoFileIsUndefined') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '録画再生の選択肢を取得',
    tags: ['videos'],
    description: '録画ファイルの映像特性と端末能力から、利用可能な再生プロファイルと推奨を返す',
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }, { $ref: '#/components/parameters/PlaybackCapabilityHevc' }, { $ref: '#/components/parameters/PlaybackCapabilityHevcMain10' }, { $ref: '#/components/parameters/PlaybackCapabilityH264' }, { $ref: '#/components/parameters/PlaybackCapabilityHdr' }, { $ref: '#/components/parameters/PlaybackCapabilityHlg' }, { $ref: '#/components/parameters/PlaybackProfile' }],
    responses: { 200: { description: '再生の選択肢を取得しました', content: { 'application/json': { schema: { $ref: '#/components/schemas/PlaybackOptions' } } } }, 404: { description: '録画ファイルが存在しません' }, default: { description: '予期しないエラー', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
};
