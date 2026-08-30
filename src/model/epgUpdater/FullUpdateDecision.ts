/**
 * 「Mirakurun から番組表を全件取り直す (updateAll) べきか」の純粋判定。
 *
 * event stream は**差分しか運ばない**。既存番組の `update` が届き続けるのに
 * 新規番組の `create` が届かない状態になると DB は古いまま残り、再起動して
 * `updateAll()` が走るまで番組表が増えない (Issue #6)。
 *
 * 既存のウォッチドッグは「イベントが一定時間来ないこと」しか見ておらず、
 * `lastEventStreamUpdatedTime` は DB 書き込みのたびに更新されるため、
 * イベントが届き続けている限り永久に発火しない。そこで event stream の状態に
 * 関わらず一定間隔で全件突き合わせる経路を足してある。
 */

export interface FullUpdateInput {
    // event stream が生きているか
    isEventStreamAlive: boolean;
    // 現在時刻 (ms)
    now: number;
    // 最後にキューを全件フラッシュした時刻 (ms)
    lastUpdatedTime: number;
    // 最後に event stream 由来の更新を DB へ書いた時刻 (ms)
    lastEventStreamUpdatedTime: number;
    // 最後に updateAll が成功した時刻 (ms)
    lastFullUpdatedTime: number;
    // EPG 更新間隔 (ms)
    updateIntervalMs: number;
    // event stream が生きていても全件突き合わせる間隔 (ms)。0 で無効
    fullRefreshIntervalMs: number;
}

export type FullUpdateReason =
    // event stream が切れている
    | 'streamDown'
    // event stream は生きているが更新が長時間来ない
    | 'staleEventStream'
    // event stream は生きているが最後の全件取得から間隔が空いた
    | 'periodic'
    // 全件取得は不要
    | null;

/**
 * updateAll を実行すべきかを判定する
 * @param input: FullUpdateInput
 * @return FullUpdateReason 実行不要なら null
 */
export const decideFullUpdate = (input: FullUpdateInput): FullUpdateReason => {
    const watchdogLimit = input.updateIntervalMs * 1.5;

    if (input.isEventStreamAlive === false) {
        return input.lastUpdatedTime + watchdogLimit <= input.now ? 'streamDown' : null;
    }

    // イベントが来ない状態。従来からのウォッチドッグ
    if (input.lastEventStreamUpdatedTime !== 0 && input.lastEventStreamUpdatedTime + watchdogLimit <= input.now) {
        return 'staleEventStream';
    }

    // イベントは届いているが、新規番組が増えていない可能性に備えた定期突き合わせ
    if (
        input.fullRefreshIntervalMs > 0 &&
        input.lastFullUpdatedTime !== 0 &&
        input.lastFullUpdatedTime + input.fullRefreshIntervalMs <= input.now
    ) {
        return 'periodic';
    }

    return null;
};

/**
 * event stream 再接続時の全件更新を実行するか判定する。
 * @param lastFullUpdatedTime: number 最後に全件更新が成功した時刻
 * @param now: number 現在時刻
 * @param minimumIntervalMs: number 再接続時の最小間隔
 * @return boolean 実行するなら true
 */
export const shouldRunStreamStartFullUpdate = (
    lastFullUpdatedTime: number,
    now: number,
    minimumIntervalMs: number,
): boolean => lastFullUpdatedTime === 0 || now - lastFullUpdatedTime >= minimumIntervalMs;
