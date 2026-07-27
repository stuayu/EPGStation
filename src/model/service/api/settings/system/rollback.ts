import { Operation } from 'express-openapi';
import IAppSettingApiModel from '../../../../api/config/IAppSettingApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
const m = () => container.get<IAppSettingApiModel>('IAppSettingApiModel');
const fail = (res: any, e: unknown) => {
    const x = api.getErrorMessage(e);
    if (x === 'SystemSettingsFeatureIsDisabled') api.responseError(res, { code: 404, message: x });
    else if (
        x.startsWith('UnknownAppSetting') ||
        x === 'AppSettingHistoryIsNotFound' ||
        x === 'AppSettingHistoryIsInvalid'
    )
        api.responseError(res, { code: 400, message: x });
    else api.responseServerError(res, x);
};
export const post: Operation = async (req, res) => {
    try {
        const key = String(req.body?.key ?? '');
        api.responseJSON(res, 200, await m().rollback(key));
    } catch (e) {
        fail(res, e);
    }
};
post.apiDoc = {
    summary: 'システム設定を直前の状態へロールバック',
    tags: ['settings'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
            },
        },
    },
    responses: {
        200: {
            description: 'ロールバック後の設定',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AppSettingUpdateResult' } } },
        },
        default: { description: 'error' },
    },
};
