import * as apid from '../../../api';
import { LoginResult } from './IAuthModel';
import { OAuthProviderId } from './OAuthProviders';

export default interface IOAuthModel {
    /**
     * 設定済み (clientId / clientSecret が入っている) プロバイダの一覧。
     * 秘密情報は含めないのでログイン画面へそのまま返せる
     * @param baseUrl: string コールバック URL の組み立てに使うベース URL
     * @return apid.AuthProviderItem[]
     */
    listProviders(baseUrl: string): apid.AuthProviderItem[];
    /**
     * 認可エンドポイントへのリダイレクト URL を作る
     * @param provider: OAuthProviderId
     * @param baseUrl: string
     * @return string
     */
    createAuthorizeUrl(provider: OAuthProviderId, baseUrl: string): string;
    /**
     * コールバックを処理してログインする
     * @param provider: OAuthProviderId
     * @param code: string 認可コード
     * @param state: string CSRF 対策の state
     * @param baseUrl: string
     * @return Promise<LoginResult>
     */
    handleCallback(provider: OAuthProviderId, code: string, state: string, baseUrl: string): Promise<LoginResult>;
}
