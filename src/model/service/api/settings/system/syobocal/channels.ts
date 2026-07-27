import { Operation } from 'express-openapi';
import IAppSettingApiModel from '../../../../../api/config/IAppSettingApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';
const m = () => container.get<IAppSettingApiModel>('IAppSettingApiModel');
const fail = (res: any, e: unknown) => {
    const x = api.getErrorMessage(e);
    if (x === 'SystemSettingsFeatureIsDisabled') api.responseError(res, { code: 404, message: x });
    else if (
        x.startsWith('UnknownAppSetting') ||
        x.startsWith('AppSettingInvalid') ||
        x === 'SyobocalChannelMapDuplicateEntry'
    )
        api.responseError(res, { code: 400, message: x });
    else api.responseServerError(res, x);
};
export const get: Operation = async (_req, res) => {
    try {
        const settings = await m().get();
        api.responseJSON(res, 200, (settings.syobocalChannelMap as unknown[]) ?? []);
    } catch (e) {
        fail(res, e);
    }
};
export const put: Operation = async (req, res) => {
    try {
        const entries: any[] = Array.isArray(req.body) ? req.body : [];
        // (networkId, serviceId) の重複はマッピングとして矛盾するため保存前に弾く
        const seen = new Set<string>();
        for (const entry of entries) {
            const key = `${entry?.networkId}:${entry?.serviceId}`;
            if (seen.has(key)) throw new Error('SyobocalChannelMapDuplicateEntry');
            seen.add(key);
        }
        const result = await m().update({ syobocalChannelMap: entries });
        api.responseJSON(res, 200, (result.settings.syobocalChannelMap as unknown[]) ?? []);
    } catch (e) {
        fail(res, e);
    }
};
get.apiDoc = {
    summary: 'しょぼいカレンダー チャンネルマッピング表取得',
    tags: ['settings'],
    responses: {
        200: {
            description:
                'マッピング表 (設定画面 (DB) からの登録分のみ。同梱/共有静的データ/ローカルファイルは含まない)',
            content: {
                'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/SyobocalChannelMapEntry' } },
                },
            },
        },
        default: { description: 'error' },
    },
};
put.apiDoc = {
    summary: 'しょぼいカレンダー チャンネルマッピング表更新 (全件置き換え)',
    tags: ['settings'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/SyobocalChannelMapEntry' } },
            },
        },
    },
    responses: {
        200: {
            description: '更新後のマッピング表',
            content: {
                'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/SyobocalChannelMapEntry' } },
                },
            },
        },
        default: { description: 'error' },
    },
};
