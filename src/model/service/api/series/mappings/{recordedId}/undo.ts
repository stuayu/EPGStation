import { Operation } from 'express-openapi';
import ISeriesMappingApiModel from '../../../../../api/series/ISeriesMappingApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
const model = () => container.get<ISeriesMappingApiModel>('ISeriesMappingApiModel');
export const post: Operation = async (req, res) => {
    try {
        const recordedId = api.parseRequestParamInt(String(req.params.recordedId), 'recordedId');
        const value = await model().undo(recordedId);
        if (value) api.responseJSON(res, 200, value);
        else api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'SeriesLibraryFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else if (message === 'SeriesChangeHistoryIsNotFound' || message === 'RecordedIsNotFound')
            api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
post.apiDoc = {
    summary: 'シリーズ割当変更のUndo (直前の履歴から復元)',
    tags: ['series'],
    responses: {
        200: { description: '成功' },
        404: { description: '履歴/録画が見つからない' },
        default: { description: '失敗' },
    },
};
