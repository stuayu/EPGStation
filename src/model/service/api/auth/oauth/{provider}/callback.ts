import { Operation } from 'express-openapi';
import IConfiguration from '../../../../../IConfiguration';
import IOAuthModel from '../../../../../auth/IOAuthModel';
import { getRequestBaseUrl } from '../../../../../auth/RequestUrl';
import { setSessionCookie } from '../../../../../auth/SessionCookie';
import { isOAuthProviderId } from '../../../../../auth/OAuthProviders';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

/**
 * ブラウザからのリダイレクトで呼ばれるため、エラーもログイン画面へ戻して伝える
 */
const redirectToClient = (res: any, configuration: IConfiguration, error?: string): void => {
    const sub = configuration.getConfig().subDirectory;
    const base = typeof sub === 'string' && sub !== '' ? (sub.startsWith('/') ? sub : `/${sub}`) : '';
    res.redirect(error ? `${base}/?authError=${encodeURIComponent(error)}` : `${base}/`);
};

export const get: Operation = async (req, res) => {
    const configuration = container.get<IConfiguration>('IConfiguration');
    try {
        const provider = req.params.provider;
        if (isOAuthProviderId(provider) === false) {
            redirectToClient(res, configuration, 'UnknownOAuthProvider');

            return;
        }
        const model = container.get<IOAuthModel>('IOAuthModel');
        const result = await model.handleCallback(
            provider,
            String(req.query.code ?? ''),
            String(req.query.state ?? ''),
            getRequestBaseUrl(req),
        );
        setSessionCookie(res, result.token, result.maxAgeSec, api.getCookiePath(configuration));
        redirectToClient(res, configuration);
    } catch (e) {
        redirectToClient(res, configuration, api.getErrorMessage(e));
    }
};

get.apiDoc = {
    summary: '外部 ID プロバイダのコールバック',
    tags: ['auth'],
    description:
        '認可コードをアクセストークンに交換してログインする。未登録のアカウントは新規ユーザーとして作成され、最初のユーザーのみシステム管理者になる (認証不要)',
    responses: {
        302: { description: 'クライアントへリダイレクト' },
        default: { description: '失敗' },
    },
};
