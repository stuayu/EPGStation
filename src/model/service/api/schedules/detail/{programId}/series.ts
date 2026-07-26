import { Operation } from 'express-openapi';
import IProgramSeriesApiModel from '../../../../../api/schedule/IProgramSeriesApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
export const get: Operation = async (req, res) => {
    try {
        const id = api.parseRequestParamInt(String(req.params.programId), 'programId');
        const result = await container.get<IProgramSeriesApiModel>('IProgramSeriesApiModel').get(id);
        if (result) api.responseJSON(res, 200, result);
        else api.responseError(res, { code: 404, message: 'program or series is not found' });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'ProgramSeriesMappingFeatureIsDisabled') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '番組のシリーズ取得',
    tags: ['series'],
    responses: { 200: { description: '成功' }, 404: { description: '未検出' }, default: { description: '失敗' } },
};
