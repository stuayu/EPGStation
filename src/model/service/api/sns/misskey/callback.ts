import { Operation } from 'express-openapi';
import ISnsApiModel from '../../../../api/sns/ISnsApiModel';
import IAuthModel from '../../../../auth/IAuthModel';
import { getRequestUserId } from '../../../../auth/RequestUser';
import IConfiguration from '../../../../IConfiguration';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

/**
 * ブラウザからのリダイレクトで呼ばれるため、エラーもアカウント連携画面へ戻して伝える
 * (`src/model/service/api/auth/oauth/{provider}/callback.ts` と同じパターン)
 */
const redirectToClient = (res: any, configuration: IConfiguration, query: string): void => {
    const sub = configuration.getConfig().subDirectory;
    const base = typeof sub === 'string' && sub !== '' ? (sub.startsWith('/') ? sub : `/${sub}`) : '';
    res.redirect(`${base}/#/settings/sns?${query}`);
};

export const get: Operation = async (req, res) => {
    const configuration = container.get<IConfiguration>('IConfiguration');
    try {
        const userId = await getRequestUserId(req, container.get<IAuthModel>('IAuthModel'));
        const sessionId = String(req.query.session ?? '');
        if (sessionId === '') {
            redirectToClient(res, configuration, `misskey=error&reason=${encodeURIComponent('InvalidSession')}`);

            return;
        }

        const model = container.get<ISnsApiModel>('ISnsApiModel');
        await model.completeMisskeyAuth(userId, sessionId);
        redirectToClient(res, configuration, 'misskey=success');
    } catch (e) {
        redirectToClient(res, configuration, `misskey=error&reason=${encodeURIComponent(api.getErrorMessage(e))}`);
    }
};

get.apiDoc = {
    summary: 'Misskey MiAuth のコールバック',
    tags: ['sns'],
    description:
        'MiAuth の承認後に Misskey からリダイレクトされるエンドポイント (認証不要)。' +
        'セッションを検証してアクセストークンを取得し、連携アカウントとして保存した上で設定画面へ 302 で戻す',
    parameters: [
        {
            name: 'session',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'MiAuth のセッション id',
        },
    ],
    responses: {
        302: { description: '連携アカウント設定画面へリダイレクト' },
    },
};
