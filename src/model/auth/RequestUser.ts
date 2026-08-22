import { Request } from 'express';
import IAuthModel from './IAuthModel';
import { SESSION_COOKIE_NAME } from './SessionCookie';
import { readCookie } from './SessionToken';

/**
 * リクエストからログイン中のユーザー id を取り出す。
 * `ServiceServer` の認証ガードはリクエストの通過可否だけを判定し `req` へは何も残さないため、
 * ユーザー id が必要なルートハンドラは各自でこの関数を呼んで Cookie を検証し直す
 * (`src/model/service/api/auth.ts` / `auth/media-token.ts` と同じパターン)。
 *
 * 認証が無効、またはログインしていない (匿名アクセス許可時) 場合は null を返す。
 * SNS 連携アカウントはこの値で分離し、null は「認証無効・匿名時の共有枠」として扱う
 * @param req: Request
 * @param authModel: IAuthModel
 * @return Promise<number | null>
 */
export const getRequestUserId = async (req: Request, authModel: IAuthModel): Promise<number | null> => {
    if (authModel.isEnabled() === false) return null;

    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const payload = await authModel.verify(token);

    return payload?.uid ?? null;
};
