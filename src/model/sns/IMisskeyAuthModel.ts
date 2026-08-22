export interface CreateMisskeyAuthSessionResult {
    sessionId: string;
    authUrl: string;
}

export interface CompleteMisskeyAuthResult {
    host: string;
    token: string;
    remoteUserId: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    // MiAuth 要求時に渡した permission 一覧。トークンへ実際に許可された範囲を DB へ記録するために使う
    // (MiAuth は permission がトークン発行時に固定されるため、後から要求権限を増やしても
    // 既存トークンには反映されない。現在の要求権限と比較して再連携が必要かを判定する)
    grantedPermissions: string[];
}

/**
 * Misskey の MiAuth によるワンクリック認証。
 * 「連携ボタン 1 つで自動認証」の実体。KonomiTV は手動トークン貼り付けのため本フォークの新規実装
 */
export default interface IMisskeyAuthModel {
    /**
     * MiAuth の認証セッションを作成し、認可 URL を返す
     * @param instanceUrl: string ユーザーが入力したインスタンス URL / ホスト名
     * @param userId: number | null リクエスト元のユーザー (認証無効・匿名時は null)
     * @param baseUrl: string コールバック URL 組み立て用 (`getRequestBaseUrl(req)`)
     * @return CreateMisskeyAuthSessionResult
     */
    createSession(instanceUrl: string, userId: number | null, baseUrl: string): CreateMisskeyAuthSessionResult;
    /**
     * コールバックを受けてセッションを検証し、MiAuth の check API を叩いてトークンを発行させる
     * @param sessionId: string
     * @param userId: number | null コールバックを受けたリクエストのユーザー (セッション作成時と一致しなければ拒否)
     * @return Promise<CompleteMisskeyAuthResult>
     */
    completeSession(sessionId: string, userId: number | null): Promise<CompleteMisskeyAuthResult>;
    /**
     * 現在アプリが要求している MiAuth の permission 一覧を返す。
     * 既存アカウントの `grantedPermissions` (連携時点の permission) と比較し、
     * 不足があれば再連携が必要と判定するために使う
     * @return string[]
     */
    getRequiredPermissions(): string[];
}
