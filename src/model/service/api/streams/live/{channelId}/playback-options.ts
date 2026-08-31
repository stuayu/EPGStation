import { Operation } from 'express-openapi';
import IPlaybackApiModel from '../../../../../api/stream/IPlaybackApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
import { parseClientCapabilities } from '../../../../../api/stream/PlaybackCapability';
import * as apid from '../../../../../../../api';

export const get: Operation = async (req, res) => {
    try {
        const model = container.get<IPlaybackApiModel>('IPlaybackApiModel');
        const channelId = api.parseRequestParamInt(req.params.channelId, 'channelId');
        const query = req.query as Record<string, unknown>;
        api.responseJSON(
            res,
            200,
            await model.getLivePlaybackOptions(
                channelId,
                parseClientCapabilities(query),
                query.profile as string | undefined,
                query.container as apid.PlaybackContainer | undefined,
            ),
        );
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'ChannelIsUndefined') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: 'ライブ再生の選択肢を取得',
    tags: ['streams'],
    description: '放送局の映像特性と端末能力から、利用可能な再生プロファイルと推奨を返す',
    parameters: [
        { $ref: '#/components/parameters/PathChannelId' },
        { $ref: '#/components/parameters/PlaybackCapabilityHevc' },
        { $ref: '#/components/parameters/PlaybackCapabilityHevcMain10' },
        { $ref: '#/components/parameters/PlaybackCapabilityH264' },
        { $ref: '#/components/parameters/PlaybackCapabilityHdr' },
        { $ref: '#/components/parameters/PlaybackCapabilityHlg' },
        { $ref: '#/components/parameters/PlaybackProfile' },
        { $ref: '#/components/parameters/PlaybackContainer' },
    ],
    responses: {
        200: {
            description: '再生の選択肢を取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PlaybackOptions' } } },
        },
        404: { description: '放送局が存在しません' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
