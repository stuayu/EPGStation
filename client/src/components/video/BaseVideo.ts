import DPlayer, { DPlayerType } from 'dplayer';
import { Component, Vue } from 'vue-facing-decorator';
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import JikkyoCommentClient, { JikkyoComment } from '@/util/JikkyoCommentClient';
import JikkyoKakologClient from '@/util/JikkyoKakologClient';
import VirtualTimeline from '@/components/video/VirtualTimeline';
import IStreamApiModel from '@/model/api/streams/IStreamApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { DataBroadcastingConnectParam } from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import * as apid from '../../../../api';

export default abstract class BaseVideo extends Vue {
    protected dp: DPlayer | null = null;
    protected containerElement: HTMLElement | null = null;
    private virtualTimeline: VirtualTimeline | null = null;
    private jikkyoCommentClient: JikkyoCommentClient | null = null;
    private jikkyoKakologClient: JikkyoKakologClient | null = null;
    private jikkyoCommentQueue: JikkyoComment[] = []; // 弾幕インスタンス生成前に届いたコメント
    private isResolvingQuality: boolean = false; // 画質切替の url 解決中か

    // ライブ配信の放送時刻 (TDT / TOT)。実況コメントの遅延補正に使う
    private broadcastTime: apid.StreamBroadcastTime | null = null;
    private broadcastTimeTimerId: number | null = null;
    // 遅延表示待ちのコメント。破棄時にまとめてキャンセルする
    private jikkyoDelayTimerIds: number[] = [];

    // DPlayer が再生速度を保存する localStorage のキー。
    // 録画とライブで同じ DPlayer 設定を共有しているため、ライブ側だけ持ち込まないようにする
    private static readonly DPLAYER_SPEED_STORAGE_KEY = 'dplayer-speed';

    private static readonly JIKKYO_COMMENT_QUEUE_LIMIT = 100;
    // 放送時刻の取り直し間隔
    private static readonly BROADCAST_TIME_INTERVAL = 15 * 1000;
    // 補正しすぎて明らかにおかしくなるのを防ぐための遅延上限
    private static readonly JIKKYO_MAX_DELAY_MS = 60 * 1000;

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

        this.dp = BaseVideo.createDPlayer(options);
        this.bindEvents();

        // ストリーミング再生は video 要素が動画の一部しか持たないため、
        // DPlayer のシークバーを動画全体の時間軸で動かすアダプタを噛ませる
        if (this.isEnabledVirtualTimeline() === true) {
            this.virtualTimeline = new VirtualTimeline(this.dp, {
                getDuration: () => this.getDuration(),
                getCurrentTime: () => this.getCurrentTime(),
                setCurrentTime: (time: number) => this.setCurrentTime(time),
                getEncodedTime: () => this.getEncodedTime(),
            });
        }

        // ライブコメントまたは録画の過去ログ取得を開始する
        if (isLiveJikkyoEnabled === true && jikkyoChannelId !== null) {
            this.jikkyoCommentClient = new JikkyoCommentClient({
                serverUrl: setting.jikkyoServerUrl,
                jikkyoChannelId: jikkyoChannelId,
                onComment: comment => this.drawJikkyoCommentWithDelay(comment),
            });
            this.jikkyoCommentClient.start();
            this.startBroadcastTimePolling();
        } else if (isKakologEnabled === true && jikkyoKakologOption !== null) {
            this.jikkyoKakologClient = new JikkyoKakologClient({
                ...jikkyoKakologOption,
                getCurrentTime: () => this.getCurrentTime(),
                onComment: comment => this.drawJikkyoComment(comment),
                onError: message => {
                    (this.dp as any)?.notice?.(message, 5000);
                },
            });
            void this.jikkyoKakologClient.start();
        }
    }

    /**
     * DPlayer を生成する。
     *
     * DPlayer は再生速度を localStorage (`dplayer-speed`) に保存し、次回の生成時に適用する。
     * 録画とライブで同じ localStorage を共有しているため、録画を倍速で見た後に
     * ライブ視聴を開くとライブまで倍速で始まってしまう。ライブでは
     * 生成時に速度設定を持ち込まず、ライブ中に変えた速度も保存しないようにする
     * (録画側で設定した速度はそのまま残す)
     * @param options: DPlayerType.Options
     * @return DPlayer
     */
    private static createDPlayer(options: DPlayerType.Options): DPlayer {
        if (options.live !== true) {
            return new DPlayer(options);
        }

        // 生成中だけ保存値を等速に見せ、生成後に元の値へ戻す
        const saved = localStorage.getItem(BaseVideo.DPLAYER_SPEED_STORAGE_KEY);
        localStorage.setItem(BaseVideo.DPLAYER_SPEED_STORAGE_KEY, '1');
        let player: DPlayer;
        try {
            player = new DPlayer(options);
        } finally {
            if (saved === null) {
                localStorage.removeItem(BaseVideo.DPLAYER_SPEED_STORAGE_KEY);
            } else {
                localStorage.setItem(BaseVideo.DPLAYER_SPEED_STORAGE_KEY, saved);
            }
        }

        // ライブ中に速度を変えても録画側の設定を上書きしない
        const user = (player as any).user;
        if (typeof user?.set === 'function') {
            const originalSet = user.set.bind(user);
            user.set = (key: string, value: unknown): void => {
                if (key === 'speed') {
                    user.data.speed = value;

                    return;
                }
                originalSet(key, value);
            };
        }

        return player;
    }

    /**
     * DPlayer の画質切替に非同期の url 解決処理を挟む
     *
     * HLS 配信はサーバー側でストリームセッションを作り直さないと
     * 新しい mode の m3u8 の url が決まらないため、
     * DPlayer 標準の switchQuality (url 固定) をラップして
     * 切替直前に url を解決してから元の処理へ渡す
     * @param option.resolveUrl: 切替後の video url を解決する関数 (失敗時は例外を投げる)
     * @param option.resetCurrentTime: true で切替後の再生位置を先頭に戻す (ストリームを再生位置から作り直す場合に使用)
     * @param option.onSwitched: url 解決後に呼ばれるコールバック
     */
    protected setupQualitySwitch(option: { resolveUrl: (mode: number) => Promise<string>; resetCurrentTime?: boolean; onSwitched?: (mode: number) => void }): void {
        if (this.dp === null) {
            return;
        }

        const dp = this.dp as any;
        if (typeof dp.options.video.quality === 'undefined') {
            return;
        }

        const originalSwitchQuality = dp.switchQuality.bind(dp);
        dp.switchQuality = (index: number | string): void => {
            const mode = typeof index === 'string' ? parseInt(index, 10) : index;
            const quality = dp.options.video.quality;
            if (isNaN(mode) === true || typeof quality[mode] === 'undefined') {
                return;
            }

            // 切替中の多重実行を防ぐ
            if (this.isResolvingQuality === true || dp.switchingQuality === true || dp.qualityIndex === mode) {
                return;
            }

            this.isResolvingQuality = true;
            dp.notice(`画質を ${quality[mode].name} に切り替えています…`, -1);

            (async (): Promise<void> => {
                try {
                    quality[mode].url = await option.resolveUrl(mode);
                } catch (err) {
                    console.error(err);
                    this.isResolvingQuality = false;
                    dp.notice('画質の切り替えに失敗しました', 3000);

                    return;
                }

                this.isResolvingQuality = false;

                // 切替処理中に破棄された場合は何もしない
                if (this.dp === null) {
                    return;
                }

                if (typeof option.onSwitched !== 'undefined') {
                    option.onSwitched(mode);
                }

                if (option.resetCurrentTime === true) {
                    // ストリームを再生位置から作り直しているため切替前の再生位置への seek を抑止し、
                    // 先頭 (= 切替前の再生位置) から再生させる
                    const isLive = dp.options.live;
                    dp.options.live = true;
                    originalSwitchQuality(mode);
                    dp.options.live = isLive;
                    dp.prevVideoCurrentTime = 0;
                } else {
                    originalSwitchQuality(mode);
                }
            })();
        };
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
     * ライブ実況のコメントを配信遅延の分だけ遅らせて描画する
     * コメントは実時間で届くのに対し、映像はチューナー → エンコード → 配信 → 再生の分だけ
     * 遅れているため、そのまま描画すると映像より先にコメントが流れてしまう
     */
    private drawJikkyoCommentWithDelay(comment: JikkyoComment): void {
        const delay = this.getJikkyoDelayMs();
        if (delay <= 0) {
            this.drawJikkyoComment(comment);

            return;
        }

        const timerId = window.setTimeout(() => {
            this.jikkyoDelayTimerIds = this.jikkyoDelayTimerIds.filter(id => id !== timerId);
            this.drawJikkyoComment(comment);
        }, delay);
        this.jikkyoDelayTimerIds.push(timerId);
    }

    /**
     * ライブ実況コメントを遅らせる時間 (ミリ秒) を求める
     *   サーバ遅延  : TDT / TOT の放送時刻とサーバがそれを受け取った時刻の差
     *                 (チューナー → Mirakurun → EPGStation の遅れ)
     *   再生側の遅延: 受信済みバッファの末尾と再生位置の差
     *   手動補正    : 設定値 (環境ごとのずれを詰めるため)
     */
    private getJikkyoDelayMs(): number {
        let delay = 0;

        if (this.broadcastTime !== null) {
            // チューナー → Mirakurun → EPGStation までの遅れ
            delay += this.broadcastTime.receivedAt - this.broadcastTime.time;
        }

        delay += this.getPlaybackBufferDelayMs();

        const setting = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
        const offset = typeof setting.jikkyoLiveOffsetSec === 'number' ? setting.jikkyoLiveOffsetSec : 0;
        delay += offset * 1000;

        if (delay < 0) {
            return 0;
        }

        return Math.min(delay, BaseVideo.JIKKYO_MAX_DELAY_MS);
    }

    /**
     * 受信済みバッファの末尾と再生位置の差 (ミリ秒)
     * ライブ再生ではこれがそのまま「映像が実時間からどれだけ遅れて表示されているか」に近い
     */
    private getPlaybackBufferDelayMs(): number {
        const video = this.dp === null ? null : (this.dp as any).video;
        if (video === null || typeof video === 'undefined' || typeof video.buffered === 'undefined') {
            return 0;
        }

        try {
            if (video.buffered.length === 0) {
                return 0;
            }
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const delay = (bufferedEnd - video.currentTime) * 1000;

            return delay > 0 ? delay : 0;
        } catch (err) {
            // buffered へのアクセスは状態によっては例外になる
            return 0;
        }
    }

    /**
     * 配信中の映像の放送時刻を定期的に取り直す
     */
    private startBroadcastTimePolling(): void {
        const channelId = this.getChannelId();
        if (channelId === null) {
            return;
        }

        const update = async (): Promise<void> => {
            try {
                const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');
                const info = await streamApiModel.getStreamInfo(false);
                const item = info.items.find(
                    x => x.channelId === channelId && typeof x.broadcastTime !== 'undefined',
                );
                this.broadcastTime = item?.broadcastTime ?? null;
            } catch (err) {
                // 取得できなくてもコメント表示自体は続ける (補正が効かなくなるだけ)
                console.error(err);
            }
        };

        void update();
        this.broadcastTimeTimerId = window.setInterval(() => {
            void update();
        }, BaseVideo.BROADCAST_TIME_INTERVAL);
    }

    /**
     * 放送時刻の取得を止め、遅延待ちのコメントを破棄する
     */
    private stopJikkyoDelay(): void {
        if (this.broadcastTimeTimerId !== null) {
            window.clearInterval(this.broadcastTimeTimerId);
            this.broadcastTimeTimerId = null;
        }
        for (const timerId of this.jikkyoDelayTimerIds) {
            window.clearTimeout(timerId);
        }
        this.jikkyoDelayTimerIds = [];
        this.broadcastTime = null;
    }

    /**
     * 視聴中の放送局 id を返す (ライブ視聴のコンポーネントで override する)
     */
    protected getChannelId(): apid.ChannelId | null {
        return null;
    }

    /**
     * ニコニコ実況コメントを DPlayer の弾幕として描画する
     */
    private drawJikkyoComment(comment: JikkyoComment): void {
        // 右パネルのコメント一覧へ流す (描画タイミング = 遅延補正後なので弾幕と表示が揃う)
        this.$emit('jikkyoComment', comment);

        const danmaku = this.dp === null ? null : (this.dp as any).danmaku;
        if (danmaku === null || typeof danmaku === 'undefined' || typeof danmaku.draw !== 'function') {
            // DPlayer の弾幕インスタンス生成前に届いたコメントは一時的に保持しておく
            if (this.jikkyoCommentQueue.length < BaseVideo.JIKKYO_COMMENT_QUEUE_LIMIT) {
                this.jikkyoCommentQueue.push(comment);
            }

            return;
        }

        // 保持していたコメントを先に描画する
        if (this.jikkyoCommentQueue.length > 0) {
            const queuedComments = this.jikkyoCommentQueue;
            this.jikkyoCommentQueue = [];
            for (const queuedComment of queuedComments) {
                BaseVideo.drawDanmaku(danmaku, queuedComment);
            }
        }

        BaseVideo.drawDanmaku(danmaku, comment);
    }

    /**
     * DPlayer の弾幕インスタンスへコメントを描画する
     */
    private static drawDanmaku(danmaku: any, comment: JikkyoComment): void {
        try {
            danmaku.draw({
                text: comment.text,
                color: comment.color,
                type: comment.type,
                size: comment.size,
            });
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * DPlayer インスタンスを破棄する
     */
    protected destroyPlayer(): void {
        this.stopJikkyoDelay();
        if (this.jikkyoCommentClient !== null) {
            this.jikkyoCommentClient.destroy();
            this.jikkyoCommentClient = null;
        }
        if (this.jikkyoKakologClient !== null) {
            this.jikkyoKakologClient.destroy();
            this.jikkyoKakologClient = null;
        }
        this.jikkyoCommentQueue = [];

        this.isResolvingQuality = false;

        if (this.virtualTimeline !== null) {
            this.virtualTimeline.destroy();
            this.virtualTimeline = null;
        }

        if (this.dp === null) {
            return;
        }

        this.dp.destroy();
        this.dp = null;
    }

    /**
     * DPlayer のシークバーを動画全体の時間軸で扱うか
     * 再生位置からエンコードし直すストリーミング再生用。サブクラスでオーバーライドする
     * @return boolean
     */
    protected isEnabledVirtualTimeline(): boolean {
        return false;
    }

    // データ放送 (BML) のシーク位置計算用の videoFile サイズ (byte)。取得できていない場合は null (先頭からの視聴扱い)
    private videoFileSizeForDataBroadcasting: number | null = null;

    /**
     * DPlayer のインスタンスを返す (データ放送 (BML) 機能が DPlayer の DOM に直接介入するために使う)
     * @return DPlayer | null
     */
    public getDPlayer(): DPlayer | null {
        return this.dp;
    }

    /**
     * データ放送 (BML) の接続パラメータを返す。既定は null (データ放送非対応の video)
     * ライブ視聴のサブクラスは channelId から、録画視聴のサブクラスは videoFileId (+ シーク位置) から組み立てて override する
     * @return DataBroadcastingConnectParam | null
     */
    public getDataBroadcastingParam(): DataBroadcastingConnectParam | null {
        return null;
    }

    /**
     * データ放送のシーク位置計算に使う videoFile のサイズを取得しておく (取得できなくても視聴自体は継続する)
     * featureFlags.dataBroadcasting が無効な場合は何もしない (不要な API 呼び出しを避ける)
     * @param videoFileId: apid.VideoFileId
     */
    protected async fetchVideoFileSizeForDataBroadcasting(videoFileId: apid.VideoFileId): Promise<void> {
        this.videoFileSizeForDataBroadcasting = null;

        const serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
        if (isFeatureEnabled(serverConfigModel.getConfig(), 'dataBroadcasting') === false) {
            return;
        }

        try {
            const metadata = await container.get<IVideoApiModel>('IVideoApiModel').getMetadata(videoFileId);
            this.videoFileSizeForDataBroadcasting = metadata.size > 0 ? metadata.size : null;
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * 録画視聴用のデータ放送接続パラメータを組み立てる
     * seek は videoFile.size × (再生位置秒 / 総再生時間秒) で求めたバイト位置の概算
     * @param videoFileId: apid.VideoFileId
     * @return DataBroadcastingConnectParam
     */
    protected buildRecordedDataBroadcastingParam(videoFileId: apid.VideoFileId): DataBroadcastingConnectParam {
        if (this.videoFileSizeForDataBroadcasting === null) {
            return { type: 'epgStationRecorded', videoFileId };
        }

        const duration = this.getDuration();
        const seek = duration > 0 ? Math.max(0, Math.floor(this.videoFileSizeForDataBroadcasting * (this.getCurrentTime() / duration))) : 0;

        return { type: 'epgStationRecorded', videoFileId, seek };
    }

    /**
     * シーク無しで再生できる位置 (エンコード済み・バッファ済みの末尾) を返す (秒)
     * @return number
     */
    public getEncodedTime(): number {
        if (this.dp === null) {
            return 0;
        }

        const buffered = this.dp.video.buffered;

        return buffered.length === 0 ? 0 : buffered.end(buffered.length - 1);
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
