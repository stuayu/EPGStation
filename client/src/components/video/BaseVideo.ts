import DPlayer, { DPlayerType } from 'dplayer';
import { Component, Vue } from 'vue-facing-decorator';
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import JikkyoCommentClient, { JikkyoComment } from '@/util/JikkyoCommentClient';
import JikkyoKakologClient from '@/util/JikkyoKakologClient';

export default abstract class BaseVideo extends Vue {
    protected dp: DPlayer | null = null;
    protected containerElement: HTMLElement | null = null;
    private jikkyoCommentClient: JikkyoCommentClient | null = null;
    private jikkyoKakologClient: JikkyoKakologClient | null = null;

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;

        this.initVideoSetting();
    }

    /**
     * video (DPlayer) 再生初期設定
     * サブクラスで DPlayer 生成用の Options を組み立て createPlayer() を呼び出す
     */
    protected abstract initVideoSetting(): void;

    /**
     * DPlayer インスタンスを生成し各種イベントを紐付ける
     * @param options: DPlayerType.Options
     */
    protected createPlayer(options: DPlayerType.Options): void {
        this.destroyPlayer();

        // ニコニコ実況 (NX-Jikkyo / 過去ログ API) のコメント弾幕表示設定
        const jikkyoChannelId = this.getJikkyoChannelId();
        const jikkyoKakologOption = this.getJikkyoKakologOption();
        const setting = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
        const isLiveJikkyoEnabled = setting.isEnableJikkyoComment === true && jikkyoChannelId !== null;
        const isKakologEnabled = setting.isEnableJikkyoComment === true && jikkyoKakologOption !== null;
        if (isLiveJikkyoEnabled === true || isKakologEnabled === true) {
            // DPlayer (tsukumijima フォーク) の弾幕描画を有効にする
            // コメントの取得は各クライアントが行うため apiBackend はダミー
            (options as any).danmaku = {
                id: jikkyoChannelId ?? jikkyoKakologOption?.jikkyoChannelId,
                user: 'EPGStation',
                api: '',
                bottom: '10%',
                unlimited: true,
            };
            (options as any).apiBackend = {
                read: (opt: any) => {
                    opt.success([]);
                },
                send: (opt: any) => {
                    opt.success();
                },
            };
        }

        this.dp = new DPlayer(options);
        this.bindEvents();

        // ライブコメントまたは録画の過去ログ取得を開始する
        if (isLiveJikkyoEnabled === true && jikkyoChannelId !== null) {
            this.jikkyoCommentClient = new JikkyoCommentClient({
                serverUrl: setting.jikkyoServerUrl,
                jikkyoChannelId: jikkyoChannelId,
                onComment: comment => this.drawJikkyoComment(comment),
            });
            this.jikkyoCommentClient.start();
        } else if (isKakologEnabled === true && jikkyoKakologOption !== null) {
            this.jikkyoKakologClient = new JikkyoKakologClient({
                ...jikkyoKakologOption,
                getCurrentTime: () => this.getCurrentTime(),
                onComment: comment => this.drawJikkyoComment(comment),
            });
            void this.jikkyoKakologClient.start();
        }
    }

    /**
     * ニコニコ実況の実況チャンネル ID (jk1 など) を返す
     * 実況コメントを表示する場合はサブクラスでオーバーライドする
     * @return string | null 実況コメントを表示しない場合は null
     */
    protected getJikkyoChannelId(): string | null {
        return null;
    }

    /**
     * 録画再生用のニコニコ実況過去ログ取得情報を返す
     */
    protected getJikkyoKakologOption(): { jikkyoChannelId: string; startAt: number; endAt: number } | null {
        return null;
    }

    /**
     * ニコニコ実況コメントを DPlayer の弾幕として描画する
     */
    private drawJikkyoComment(comment: JikkyoComment): void {
        if (this.dp === null || typeof (this.dp as any).danmaku === 'undefined') {
            return;
        }
        (this.dp as any).danmaku.draw({
            text: comment.text,
            color: comment.color,
            type: comment.type,
            size: comment.size,
        });
    }

    /**
     * DPlayer インスタンスを破棄する
     */
    protected destroyPlayer(): void {
        if (this.jikkyoCommentClient !== null) {
            this.jikkyoCommentClient.destroy();
            this.jikkyoCommentClient = null;
        }
        if (this.jikkyoKakologClient !== null) {
            this.jikkyoKakologClient.destroy();
            this.jikkyoKakologClient = null;
        }

        if (this.dp === null) {
            return;
        }

        this.dp.destroy();
        this.dp = null;
    }

    /**
     * DPlayer のイベントを Vue イベントへ橋渡しする
     */
    private bindEvents(): void {
        if (this.dp === null) {
            return;
        }

        const dp = this.dp;

        // 時刻更新
        dp.on('timeupdate', this.onTimeupdate.bind(this));

        // 読み込み中
        dp.on('waiting', this.onWaiting.bind(this));

        // 読み込み完了
        dp.on('loadeddata', this.onLoadeddata.bind(this));

        // 再生可能
        dp.on('canplay', this.onCanplay.bind(this));

        // 終了
        dp.on('ended', this.onEnded.bind(this));

        // 再生
        dp.on('play', this.onPlay.bind(this));

        // 停止
        dp.on('pause', this.onPause.bind(this));

        // 再生速度変化
        dp.on('ratechange', this.onRatechange.bind(this));

        // 音量変化
        dp.on('volumechange', this.onVolumechange.bind(this));
    }

    /**
     * 時刻更新
     */
    protected onTimeupdate(): void {
        this.jikkyoKakologClient?.tick();
        this.$emit('timeupdate');
    }

    /**
     * 読み込み中
     */
    protected onWaiting(): void {
        this.$emit('waiting');
    }

    /**
     * 読み込み完了
     */
    protected onLoadeddata(): void {
        this.$emit('loadeddata');
    }

    /**
     * 再生可能
     */
    protected onCanplay(): void {
        this.$emit('canplay');
    }

    /**
     * 終了
     */
    protected onEnded(): void {
        this.$emit('ended');
    }

    /**
     * 再生
     */
    protected onPlay(): void {
        this.$emit('play');
    }

    /**
     * 停止
     */
    protected onPause(): void {
        this.$emit('pause');
    }

    /**
     * 再生速度変化
     */
    protected onRatechange(): void {
        this.$emit('ratechange');
    }

    /**
     * 音量変化
     */
    protected onVolumechange(): void {
        this.$emit('volumechange');
    }

    public beforeUnmount(): void {
        this.destroyPlayer();
    }

    /**
     * 動画再生
     */
    public async play(): Promise<void> {
        if (this.dp === null) {
            return;
        }

        this.dp.play();
    }

    /**
     * 動画停止
     */
    public pause(): void {
        if (this.dp === null) {
            return;
        }

        this.dp.pause();
    }

    /**
     * 停止中か
     */
    public paused(): boolean {
        return this.dp === null ? true : this.dp.paused;
    }

    /**
     * 再生速度を返す
     */
    public getPlaybackRate(): number {
        return this.dp === null ? 1.0 : this.dp.video.playbackRate;
    }

    /**
     * 再生速度を設定する
     */
    public setPlaybackRate(rate: number): void {
        if (this.dp === null) {
            return;
        }

        this.dp.speed(rate);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        if (this.dp === null) {
            return 0;
        }

        const duration = this.dp.video.duration;

        return duration === Infinity || isNaN(duration) ? 0 : duration;
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        if (this.dp === null) {
            return 0;
        }

        const currentTime = this.dp.video.currentTime;

        return currentTime === Infinity || isNaN(currentTime) ? 0 : currentTime;
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        if (this.dp === null) {
            return;
        }

        this.dp.seek(time, true);
    }

    /**
     * 音量を返す
     * @return number
     */
    public getVolume(): number {
        return this.dp === null || this.dp.video.muted ? 0 : this.dp.video.volume;
    }

    /**
     * mute 切り替え
     */
    public switchMute(): void {
        if (this.dp === null) {
            return;
        }

        this.dp.video.muted = !this.dp.video.muted;
    }

    /**
     * 音量設定
     * @param volume: number 0.0 ~ 1.0
     */
    public setVolume(volume: number): void {
        if (this.dp === null) {
            return;
        }

        this.dp.volume(volume, false, true);
    }

    /**
     * フルスクリーンリクエスト (DPlayer 標準 UI に委譲する)
     */
    public requestFullscreen(): boolean {
        if (this.dp === null) {
            return false;
        }

        this.dp.fullScreen.toggle('browser');

        return true;
    }

    /**
     * 字幕が有効か
     * @return boolean true で有効
     */
    public isEnabledSubtitles(): boolean {
        return this.dp !== null && this.dp.subtitle !== null;
    }

    /**
     * 字幕が表示されているか
     * @return boolean true で表示されている
     */
    public isShowingSubtitle(): boolean {
        return this.dp !== null && this.dp.subtitle !== null && this.dp.subtitle.container.classList.contains('dplayer-subtitle-hide') === false;
    }

    /**
     * 字幕を表示させる
     */
    public showSubtitle(): void {
        if (this.dp === null || this.dp.subtitle === null) {
            return;
        }

        this.dp.subtitle.show();
    }

    /**
     * 字幕を非表示にする
     */
    public disabledSubtitle(): void {
        if (this.dp === null || this.dp.subtitle === null) {
            return;
        }

        this.dp.subtitle.hide();
    }
}
