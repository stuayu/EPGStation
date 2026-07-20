import { inject, injectable } from 'inversify';
import IStatusApiModel from '../../api/status/IStatusApiModel';
import IServerStatusState from './IServerStatusState';

@injectable()
class ServerStatusState implements IServerStatusState {
    // mirakurun への接続が生きているか (デフォルトは true として不要なバナー表示を避ける)
    public isMirakurunAlive: boolean = true;
    // 利用者がバナーを閉じたか
    public isBannerClosed: boolean = false;

    private statusApiModel: IStatusApiModel;
    private timerId: ReturnType<typeof setInterval> | null = null;

    constructor(@inject('IStatusApiModel') statusApiModel: IStatusApiModel) {
        this.statusApiModel = statusApiModel;
    }

    /**
     * サーバへ接続状態を問い合わせて反映する
     */
    public async fetch(): Promise<void> {
        try {
            const status = await this.statusApiModel.getStatus();
            const isAlive = status.mirakurun.isAlive;

            // mirakurun が復旧した場合は自動的にバナーを再表示できるようにリセットする
            if (isAlive === true && this.isMirakurunAlive === false) {
                this.isBannerClosed = false;
            }

            this.isMirakurunAlive = isAlive;
        } catch (err) {
            // ステータス取得自体に失敗した場合は状態を変更しない
            console.error(err);
        }
    }

    /**
     * 定期的にサーバの接続状態を取得する
     */
    public startPolling(): void {
        if (this.timerId !== null) {
            return;
        }

        this.timerId = setInterval(() => {
            this.fetch();
        }, ServerStatusState.POLLING_INTERVAL);
    }

    /**
     * 定期取得を停止する
     */
    public stopPolling(): void {
        if (this.timerId === null) {
            return;
        }

        clearInterval(this.timerId);
        this.timerId = null;
    }

    /**
     * バナーを閉じる
     */
    public closeBanner(): void {
        this.isBannerClosed = true;
    }
}

namespace ServerStatusState {
    export const POLLING_INTERVAL = 60000;
}

export default ServerStatusState;
