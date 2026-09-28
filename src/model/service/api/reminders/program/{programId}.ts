import { Operation } from 'express-openapi';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import IProgramReminderApiModel from '../../../../api/reminder/IProgramReminderApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<IProgramReminderApiModel>('IProgramReminderApiModel');
        const programId = api.parseRequestParamInt(req.params.programId, 'programId');
        api.responseJSON(res, 200, { reminder: await model.get(programId, userId) });
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'InvalidRequestParam') api.responseError(res, { code: 400, message });
        else api.responseServerError(res, message);
    }
};
get.apiDoc = {
    summary: '番組のリマインダー登録状態取得',
    tags: ['reminders'],
    parameters: [{ name: 'programId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: {
        200: {
            description: '登録状態',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProgramReminderResponse' } } },
        },
    },
};
