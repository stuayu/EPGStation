import { Operation } from 'express-openapi';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import IProgramReminderApiModel from '../../../api/reminder/IProgramReminderApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const delete_: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<IProgramReminderApiModel>('IProgramReminderApiModel');
        await model.delete(api.parseRequestParamInt(req.params.reminderId, 'reminderId'), userId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'InvalidRequestParam' || message === 'InvalidRequestBody')
            api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
export { delete_ as delete };
delete_.apiDoc = {
    summary: '番組開始前リマインダー削除',
    tags: ['reminders'],
    parameters: [{ name: 'reminderId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: { 200: { description: '削除結果' } },
};
