export interface MisskeyAuthSession {
    sessionId: string;
    host: string;
    // セッションを作成したユーザー (認証無効・匿名時は null)。
    // コールバック時のリクエストのユーザーと一致するかの照合に使う (取り違え対策)
    userId: number | null;
    createdAt: number;
}

/**
 * MiAuth の認証セッションをメモリ上に保持するストア。
 * DB には入れない (仕様書どおり、認証完了までの一時状態のため)。
 * TTL (既定 10 分) を超えたセッションは参照のたびに掃除する
 */
export default class MisskeyAuthSessionStore {
    public static readonly TTL_MS = 10 * 60 * 1000;

    private sessions = new Map<string, MisskeyAuthSession>();

    /**
     * セッションを新規作成する
     * @param sessionId: string
     * @param host: string
     * @param userId: number | null
     * @param now?: number テスト用に現在時刻を差し替え可能にする
     */
    public create(sessionId: string, host: string, userId: number | null, now: number = Date.now()): void {
        this.prune(now);
        this.sessions.set(sessionId, { sessionId, host, userId, createdAt: now });
    }

    /**
     * セッションを取得する。存在しない / 期限切れなら null
     * @param sessionId: string
     * @param now?: number
     * @return MisskeyAuthSession | null
     */
    public get(sessionId: string, now: number = Date.now()): MisskeyAuthSession | null {
        this.prune(now);

        return this.sessions.get(sessionId) ?? null;
    }

    /**
     * セッションを削除する (認証完了後の後始末)
     * @param sessionId: string
     */
    public remove(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /**
     * 保持中のセッション数 (テスト用)
     * @return number
     */
    public size(): number {
        return this.sessions.size;
    }

    /**
     * TTL を超えたセッションを掃除する
     * @param now: number
     */
    private prune(now: number): void {
        for (const [id, session] of this.sessions) {
            if (now - session.createdAt > MisskeyAuthSessionStore.TTL_MS) {
                this.sessions.delete(id);
            }
        }
    }
}
