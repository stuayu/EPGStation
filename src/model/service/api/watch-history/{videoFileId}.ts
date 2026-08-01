import { Operation } from 'express-openapi';
import IWatchHistoryApiModel from '../../../api/video/IWatchHistoryApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const del: Operation = async (req, res) => {
    try {
        const model = container.get<IWatchHistoryApiModel>('IWatchHistoryApiModel');
        await model.delete(api.parseRequestParamInt(req.params.videoFileId, 'videoFileId'));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'WatchHistoryFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'watch history feature is disabled' });
        else api.responseServerError(res, message);
    }
};

del.apiDoc = {
    summary: '視聴履歴の削除',
    tags: ['watch-history'],
    description: '指定したビデオファイルの視聴履歴 (再生位置・視聴状態) を削除する',
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: { description: '削除しました' },
        404: { description: '視聴履歴機能が無効' },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
