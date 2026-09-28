import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IAuthModel from '../../../auth/IAuthModel';
import { getRequestUserId } from '../../../auth/RequestUser';
import IProgramReminderApiModel from '../../../api/reminder/IProgramReminderApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const model = () => container.get<IProgramReminderApiModel>('IProgramReminderApiModel');
const user = (req: any) => getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
const handleError = (res: any, e: unknown): void => {
    const message = api.getErrorMessage(e);
    if (message === 'InvalidRequestBody') api.responseError(res, { code: 400, message });
    else if (message === 'ProgramReminderProgramIsNotFound') api.responseError(res, { code: 404, message });
    else api.responseServerError(res, message);
};

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, { reminders: await model().gets(await user(req)) });
    } catch (e) {
        handleError(res, e);
    }
};
get.apiDoc = {
    summary: '番組リマインダー一覧取得',
    tags: ['reminders'],
    responses: {
        200: {
            description: '一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProgramReminderItems' } } },
        },
    },
};

export const post: Operation = async (req, res) => {
    try {
        const body = req.body as apid.AddProgramReminderOption;
        api.responseJSON(res, 200, {
            reminder: await model().create(body.programId, body.minutesBefore, await user(req)),
        });
    } catch (e) {
        handleError(res, e);
    }
};
post.apiDoc = {
    summary: '番組開始前リマインダー登録',
    tags: ['reminders'],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AddProgramReminderOption' } } },
    },
    responses: {
        200: {
            description: '登録結果',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProgramReminderResponse' } } },
        },
    },
};
