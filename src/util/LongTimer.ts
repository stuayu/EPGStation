/**
 * setTimeout の 32bit 制限を超える待ち時間を扱うタイマー。
 *
 * Node.js の `setTimeout` は遅延が 2^31-1 ms (約 24.8 日) を超えると
 * **警告を出して 1ms へ丸め、即座に発火する**。予約の開始時刻・終了時刻から
 * 遅延を計算している箇所では、数週間先の予約 (時刻指定予約は任意の未来を
 * 指定できる) がその場で発火してしまう。
 *
 * ここでは上限以下のチャンクへ分割して再武装し、残り時間が上限内に
 * 収まってから実際のコールバックを呼ぶ。
 */
export default class LongTimer {
    // setTimeout が丸めずに扱える上限 (2^31-1 ms)
    private static readonly MAX_DELAY = 2147483647;

    private timerId: NodeJS.Timeout | null = null;

    /**
     * 指定ミリ秒後にコールバックを呼ぶ。既存の待機は破棄する
     * @param callback: () => void
     * @param delayMs: number 負値は 0 として扱う
     */
    public set(callback: () => void, delayMs: number): void {
        this.clear();

        let remaining = Number.isFinite(delayMs) === true ? Math.max(0, delayMs) : 0;
        const arm = (): void => {
            if (remaining <= LongTimer.MAX_DELAY) {
                this.timerId = setTimeout(() => {
                    this.timerId = null;
                    callback();
                }, remaining);

                return;
            }

            remaining -= LongTimer.MAX_DELAY;
            this.timerId = setTimeout(arm, LongTimer.MAX_DELAY);
        };
        arm();
    }

    /**
     * 待機を破棄する
     */
    public clear(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    /**
     * 待機中か
     * @return boolean
     */
    public get isPending(): boolean {
        return this.timerId !== null;
    }
}
