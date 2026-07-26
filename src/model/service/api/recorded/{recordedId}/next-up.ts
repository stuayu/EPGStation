import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const nextUp = await recordedApiModel.getNextUp(
            api.parseRequestParamInt(req.params.recordedId, 'recordedId'),
            req.query.isHalfWidth as any as boolean,
        );
        if (nextUp === null) {
            api.responseError(res, { code: 404, message: 'recorded is not Found' });
        } else {
            api.responseJSON(res, 200, nextUp);
        }
    } catch (err: unknown) {
        const message = api.getErrorMessage(err);
        if (message === 'NextUpPanelFeatureIsDisabled')
            api.responseError(res, { code: 404, message: 'next up feature is disabled' });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '次に見る候補を取得',
    tags: ['recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }, { $ref: '#/components/parameters/IsHalfWidth' }],
    responses: {
        200: { description: '取得しました' },
        404: { description: '録画または機能がない' },
        default: { description: '予期しないエラー' },
    },
};
