import { Operation } from 'express-openapi';
import IOAuthModel from '../../../../auth/IOAuthModel';
import { isOAuthProviderId } from '../../../../auth/OAuthProviders';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getRequestBaseUrl } from '../../../../auth/RequestUrl';

export const get: Operation = async (req, res) => {
    try {
        const provider = req.params.provider;
        if (isOAuthProviderId(provider) === false) {
            api.responseError(res, { code: 404, message: 'UnknownOAuthProvider' });

            return;
        }
        const model = container.get<IOAuthModel>('IOAuthModel');
        // 認可画面へリダイレクトする (ブラウザから直接開かれる想定)
        res.redirect(model.createAuthorizeUrl(provider, getRequestBaseUrl(req)));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'OAuthProviderIsNotConfigured') api.responseError(res, { code: 404, message });
        else api.responseServerError(res, message);
    }
};

get.apiDoc = {
    summary: '外部 ID プロバイダの認可画面へリダイレクト',
    tags: ['auth'],
    description: 'Google / GitHub の認可エンドポイントへ 302 で飛ばす (認証不要)',
    responses: {
        302: { description: '認可画面へリダイレクト' },
        404: { description: '未設定のプロバイダ' },
        default: { description: '失敗' },
    },
};
