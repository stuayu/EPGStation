import { Operation } from 'express-openapi';
import IAppSettingApiModel from '../../../../api/config/IAppSettingApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
const m = () => container.get<IAppSettingApiModel>('IAppSettingApiModel');
const fail = (res: any, e: unknown) => {
    const x = api.getErrorMessage(e);
    if (x === 'SystemSettingsFeatureIsDisabled') api.responseError(res, { code: 404, message: x });
    else if (x.startsWith('UnknownAppSetting')) api.responseError(res, { code: 400, message: x });
    else api.responseServerError(res, x);
};
export const get: Operation = async (req, res) => {
    try {
        const key = String(req.query.key ?? '');
        api.responseJSON(res, 200, await m().getHistory(key));
    } catch (e) {
        fail(res, e);
    }
};
get.apiDoc = {
    summary: 'システム設定の変更履歴取得',
    tags: ['settings'],
    parameters: [
        {
            description: '対象のトップレベルキー (metadata / notifications / series / dashboard)',
            in: 'query',
            name: 'key',
            required: true,
            schema: { type: 'string' },
        },
    ],
    responses: {
        200: {
            description: '変更履歴一覧',
            content: {
                'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/AppSettingHistoryItem' } },
                },
            },
        },
        default: { description: 'error' },
    },
};
