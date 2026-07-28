import { Operation } from 'express-openapi';
import { clearSessionCookie } from '../../../auth/SessionCookie';
import IConfiguration from '../../../IConfiguration';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    try {
        clearSessionCookie(res, api.getCookiePath(container.get<IConfiguration>('IConfiguration')));
        api.responseJSON(res, 200, { code: 200 });
    } catch (e) {
        api.responseServerError(res, api.getErrorMessage(e));
    }
};

post.apiDoc = {
    summary: 'ログアウト',
    tags: ['auth'],
    description: 'セッション Cookie を破棄する (認証不要)',
    responses: { 200: { description: '成功' }, default: { description: '失敗' } },
};
