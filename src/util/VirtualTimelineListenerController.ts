/**
 * VirtualTimeline の描画 listener を常に 1 個だけ保持する。
 * DPlayer が video の再初期化時に標準 listener を後から追加するため、
 * 再接続して登録順を最後へ移す用途に使う。
 */
export default class VirtualTimelineListenerController {
    private attached = false;

    public constructor(
        private readonly attachListener: () => void,
        private readonly detachListener: () => void,
    ) {}

    /** listener を未接続なら接続する */
    public attach(): void {
        if (this.attached === true) return;

        this.attachListener();
        this.attached = true;
    }

    /** listener をいったん外し、登録順を最新にして接続する */
    public reattach(): void {
        if (this.attached === true) this.detachListener();
        this.attachListener();
        this.attached = true;
    }

    /** listener を接続中なら外す */
    public detach(): void {
        if (this.attached === false) return;

        this.detachListener();
        this.attached = false;
    }

    /** listener が接続中か */
    public isAttached(): boolean {
        return this.attached;
    }
}
