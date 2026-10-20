/** 停止要求とタスク投入完了の競合をまとめて扱う。 */
export default class AmatsukazeCancelController {
    private cancel: () => void;
    private hasTask = false;
    private isFinished = false;
    private isCanceling = false;
    private hasStopRequest = false;

    constructor(cancel: () => void) {
        this.cancel = cancel;
    }

    /** 停止要求を記録し、投入済みなら一度だけ cancel を呼ぶ。 */
    public request(): void {
        if (this.isFinished === true || this.isCanceling === true) return;
        this.hasStopRequest = true;
        this.runCancelIfReady();
    }

    /** タスク投入完了を記録し、先行した停止要求を反映する。 */
    public taskAdded(): void {
        this.hasTask = true;
        this.runCancelIfReady();
    }

    /** 正常完了を記録し、後続の stdin close などを無視する。 */
    public finish(): void {
        this.isFinished = true;
    }

    private runCancelIfReady(): void {
        if (this.hasTask === false || this.hasStopRequest === false || this.isCanceling === true) return;
        this.isCanceling = true;
        this.cancel();
    }
}
