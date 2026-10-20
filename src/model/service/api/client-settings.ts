import { Operation } from 'express-openapi';
import IClientSettingsApiModel from '../../api/clientSettings/IClientSettingsApiModel';
import { validateClientSettings } from '../../api/clientSettings/ClientSettingsApiUtil';
import IAuthModel from '../../auth/IAuthModel';
import { getRequestUserId } from '../../auth/RequestUser';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const model = container.get<IClientSettingsApiModel>('IClientSettingsApiModel');
        api.responseJSON(res, 200, await model.get(userId));
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

get.apiDoc = {
    summary: 'クライアント設定取得',
    tags: ['clientSettings'],
    description: 'ログインユーザーまたは匿名共有枠に保存されたクライアント設定を返す',
    responses: {
        200: {
            description: '設定。未保存の場合は空オブジェクトと updatedAt 0',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ClientSettingsResponse' } } },
        },
    },
};

export const put: Operation = async (req, res) => {
    try {
        const authModel = container.get<IAuthModel>('IAuthModel');
        const userId = await getRequestUserId(req, authModel);
        if (authModel.isEnabled() && userId === null) {
            api.responseError(res, { code: 401, message: 'Unauthorized' });
            return;
        }

        const body: unknown = req.body;
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            api.responseError(res, { code: 400, message: 'InvalidClientSettings' });
            return;
        }
        const value = body as Record<string, unknown>;
        if (!Number.isSafeInteger(value.baseUpdatedAt) || (value.baseUpdatedAt as number) < 0) {
            api.responseError(res, { code: 400, message: 'InvalidClientSettings' });
            return;
        }
        const validationError = validateClientSettings(value.settings);
        if (validationError !== null) {
            api.responseError(res, {
                code: validationError === 'ClientSettingsTooLarge' ? 413 : 400,
                message: validationError,
            });
            return;
        }

        const model = container.get<IClientSettingsApiModel>('IClientSettingsApiModel');
        try {
            api.responseJSON(
                res,
                200,
                await model.put(userId, value.settings as Record<string, unknown>, value.baseUpdatedAt as number),
            );
        } catch (err: unknown) {
            if (api.getErrorMessage(err) === 'ClientSettingsConflict') {
                api.responseJSON(res, 409, await model.get(userId));
            } else {
                throw err;
            }
        }
    } catch (err: unknown) {
        api.responseServerError(res, api.getErrorMessage(err));
    }
};

put.apiDoc = {
    summary: 'クライアント設定保存',
    tags: ['clientSettings'],
    description:
        'ログインユーザーの設定を保存する。認証無効時は匿名共有枠へ保存し、認証有効時の未ログイン PUT は拒否する。baseUpdatedAt より新しいサーバー値がある場合は 409 とサーバー値を返す',
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PutClientSettingsOption' } } },
    },
    responses: {
        200: {
            description: '保存後の設定',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ClientSettingsResponse' } } },
        },
        400: { description: 'リクエストが不正' },
        401: { description: '認証が必要' },
        409: {
            description: 'サーバー側の設定が新しい',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ClientSettingsResponse' } } },
        },
        413: { description: '設定が 256 KiB を超える' },
    },
};
