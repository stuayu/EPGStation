import { Operation } from 'express-openapi';
import IAppSettingApiModel from '../../../api/config/IAppSettingApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
const m = () => container.get<IAppSettingApiModel>('IAppSettingApiModel');
const fail = (res: any, e: unknown) => {
    const x = api.getErrorMessage(e);
    if (x === 'SystemSettingsFeatureIsDisabled') api.responseError(res, { code: 404, message: x });
    else if (
        x.startsWith('UnknownAppSetting') ||
        x === 'AppSettingsMustBeObject' ||
        x.startsWith('AppSettingInvalid') ||
        x === 'AppSettingSecretKeyIsNotConfigured'
    )
        api.responseError(res, { code: 400, message: x });
    else api.responseServerError(res, x);
};
export const get: Operation = async (_q, res) => {
    try {
        api.responseJSON(res, 200, await m().get());
    } catch (e) {
        fail(res, e);
    }
};
export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, await m().update(req.body));
    } catch (e) {
        fail(res, e);
    }
};
get.apiDoc = {
    summary: 'システム設定取得',
    tags: ['settings'],
    responses: {
        200: {
            description: '設定',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AppSettingValue' } } },
        },
        default: { description: 'error' },
    },
};
put.apiDoc = {
    summary: 'システム設定更新',
    tags: ['settings'],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AppSettingValue' } } },
    },
    responses: {
        200: {
            description: '更新結果 (settings / requiresRestart)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AppSettingUpdateResult' } } },
        },
        default: { description: 'error' },
    },
};
