import DPlayer from 'dplayer';

/**
 * 仮想タイムラインの値を提供するオブジェクト
 * (BaseVideo の実装クラスがそのまま渡される)
 */
export interface VirtualTimelineSource {
    getDuration(): number; // 動画全体の長さ (秒)
    getCurrentTime(): number; // 動画全体から見た再生位置 (秒)
    setCurrentTime(time: number): void; // 動画全体から見た位置へシークする
    getEncodedTime(): number; // エンコード (バッファ) 済みの位置 (秒)
}

/**
 * DPlayer のシークバーを「動画全体」の時間軸で動かすためのアダプタ
 *
 * 録画のストリーミング再生は再生位置からエンコードし直す方式のため、
 * video 要素は「現在のストリームの断片」しか持っておらず、
 * DPlayer 標準のシークバーには断片の長さ・位置しか出ない。
 * ここで DPlayer の表示更新とシーク操作を乗っ取り、
 * VirtualTimelineSource が返す動画全体の値に置き換える。
 */
/**
 * チャプターマーカー 1 件分 (DPlayer の options.highlight の要素)
 */
interface HighlightItem {
    time: number;
    text?: string;
}

export default class VirtualTimeline {
    private static readonly UPDATE_INTERVAL = 250; // シークバー表示の更新間隔 (ms)

    private dp: DPlayer;
    private source: VirtualTimelineSource;
    private updateTimerId: ReturnType<typeof setInterval> | undefined;
    private originalSeek: ((time: number, hideNotice?: boolean) => void) | null = null;
    private highlights: HighlightItem[] = []; // DPlayer から引き取ったチャプターマーカー
    private highlightElements: HTMLElement[] = []; // 上記に対応するマーカーの DOM
    private dragPercentage: number | null = null; // シークバーをドラッグ中の位置 (0.0 ~ 1.0)
    private isPausedBeforeDrag: boolean = false;
    private updateListener = (): void => {
        this.update();
    };
    private dragStartListener = (event: Event): void => {
        this.onDragStart(event);
    };
    private dragMoveListener = (event: Event): void => {
        this.onDragMove(event);
    };
    private dragEndListener = (event: Event): void => {
        this.onDragEnd(event);
    };
    private hoverListener = (event: Event): void => {
        this.onHover(event);
    };

    constructor(dp: DPlayer, source: VirtualTimelineSource) {
        this.dp = dp;
        this.source = source;

        this.setupSeek();
        this.setupBarEvents();
        this.setupHighlights();

        // DPlayer 側の更新の後に上書きするため、DPlayer の生成後に登録する
        this.dp.on('timeupdate', this.updateListener);
        this.dp.on('durationchange', this.updateListener);
        this.dp.on('progress', this.updateListener);
        this.dp.on('canplay', this.updateListener);

        // 再生が止まっている間 (ストリーム作り直し中など) も表示を追従させる
        this.updateTimerId = setInterval(this.updateListener, VirtualTimeline.UPDATE_INTERVAL);
        this.update();
    }

    /**
     * 破棄する
     */
    public destroy(): void {
        clearInterval(this.updateTimerId);

        this.dp.off('timeupdate', this.updateListener);
        this.dp.off('durationchange', this.updateListener);
        this.dp.off('progress', this.updateListener);
        this.dp.off('canplay', this.updateListener);

        const parent = this.getBarEventTarget();
        if (parent !== null) {
            parent.removeEventListener('mousedown', this.dragStartListener, true);
            parent.removeEventListener('touchstart', this.dragStartListener, true);
            parent.removeEventListener('mousemove', this.hoverListener, false);
        }
        this.removeDragListeners();

        if (this.originalSeek !== null) {
            (this.dp as any).seek = this.originalSeek;
            this.originalSeek = null;
        }

        // 自前で作ったチャプターマーカーを片付け、DPlayer へ描画を返す
        for (const element of this.highlightElements) {
            element.remove();
        }
        this.highlightElements = [];
        if (this.highlights.length > 0) {
            (this.dp.options as any).highlight = this.highlights;
        }
    }

    /**
     * シークバーの表示 (再生位置・エンコード済み位置・時刻) を更新する
     */
    public update(): void {
        const duration = this.source.getDuration();
        if (duration <= 0) {
            return;
        }

        const currentTime = this.dragPercentage === null ? this.source.getCurrentTime() : this.dragPercentage * duration;

        this.dp.bar.set('played', VirtualTimeline.toPercentage(currentTime, duration), 'width');
        this.dp.bar.set('loaded', VirtualTimeline.toPercentage(this.source.getEncodedTime(), duration), 'width');

        const ptime = VirtualTimeline.secondToTime(currentTime);
        if (this.dp.template.ptime.textContent !== ptime) {
            this.dp.template.ptime.textContent = ptime;
        }

        const dtime = VirtualTimeline.secondToTime(duration);
        if (this.dp.template.dtime.textContent !== dtime) {
            this.dp.template.dtime.textContent = dtime;
        }

        this.updateHighlights(duration);
    }

    /**
     * チャプターマーカー (highlight) の描画を DPlayer から引き取る
     *
     * DPlayer は durationchange のたびにマーカーを作り直し、位置を
     * `time / video.duration` で決めている。ストリーミング再生の video.duration は
     * 「エンコードが済んだところまでの長さ」なので、そのままにするとエンコードが進むたびに
     * マーカーが動いてしまう。options.highlight を取り上げて DPlayer 側の再描画を止め、
     * 動画全体の長さを分母にして自分で描く
     */
    private setupHighlights(): void {
        const options = this.dp.options as any;
        const items: any[] = Array.isArray(options.highlight) === true ? options.highlight : [];

        this.highlights = items
            .filter(item => typeof item?.time === 'number' && isFinite(item.time) === true && item.time >= 0)
            .map(item => ({ time: item.time, text: typeof item.text === 'string' ? item.text : undefined }));

        // DPlayer の durationchange ハンドラは options.highlight が無ければ何もしない
        options.highlight = undefined;

        this.renderHighlights();
    }

    /**
     * チャプターマーカーの DOM を作る (位置は updateHighlights が決める)
     */
    private renderHighlights(): void {
        const barWrap = this.dp.template.playedBarWrap;
        if (typeof barWrap === 'undefined' || barWrap === null) {
            return;
        }

        // DPlayer が先に作ったマーカーが残っていれば消す
        barWrap.querySelectorAll('.dplayer-highlight').forEach(element => {
            element.remove();
        });

        this.highlightElements = this.highlights.map(item => {
            const marker = document.createElement('div');
            marker.classList.add('dplayer-highlight');

            const label = document.createElement('span');
            label.classList.add('dplayer-highlight-text');
            label.textContent = item.text ?? 'チャプター';
            marker.appendChild(label);
            barWrap.insertBefore(marker, this.dp.template.playedBarTime);

            return marker;
        });
    }

    /**
     * チャプターマーカーの位置を動画全体の長さを基準に更新する
     * @param duration: number 動画全体の長さ (秒)
     */
    private updateHighlights(duration: number): void {
        for (let i = 0; i < this.highlightElements.length; i++) {
            const left = `${VirtualTimeline.toPercentage(this.highlights[i].time, duration) * 100}%`;
            if (this.highlightElements[i].style.left !== left) {
                this.highlightElements[i].style.left = left;
            }
        }
    }

    /**
     * DPlayer.seek() を仮想タイムライン対応に差し替える
     *
     * ホットキー (←→) やスキップボタンは video 要素の実時間で seek を呼ぶため、
     * 現在のストリームの範囲外へ出る場合のみ仮想シークへ振り替える。
     * 範囲内の場合は DPlayer 標準の挙動 (画質切替時の再生位置復元など) を壊さないようそのまま流す。
     */
    private setupSeek(): void {
        const dp = this.dp as any;
        this.originalSeek = dp.seek.bind(this.dp);

        dp.seek = (time: number, hideNotice?: boolean): void => {
            const realDuration = this.dp.video.duration;
            const isInStream = isFinite(realDuration) === true && time >= 0 && time <= realDuration;

            if (isInStream === true || this.originalSeek === null) {
                this.originalSeek?.(time, hideNotice);
                this.update();

                return;
            }

            // ストリームの範囲外はストリームを作り直してシークする
            this.source.setCurrentTime(this.getBaseTime() + time);
            this.update();
        };
    }

    /**
     * シークバーの操作を乗っ取る
     *
     * DPlayer はシークバー (playedBarWrap) 自身にドラッグ開始のリスナを登録しているため、
     * 親要素のキャプチャフェーズで止めてから独自の処理を行う
     */
    private setupBarEvents(): void {
        const parent = this.getBarEventTarget();
        if (parent === null) {
            return;
        }

        parent.addEventListener('mousedown', this.dragStartListener, true);
        parent.addEventListener('touchstart', this.dragStartListener, true);
        // ホバー時のプレビュー時刻は DPlayer が実時間で書き込むため、その後に上書きする
        parent.addEventListener('mousemove', this.hoverListener, false);
    }

    /**
     * シークバー操作を横取りするための要素 (シークバーの親) を返す
     * @return HTMLElement | null
     */
    private getBarEventTarget(): HTMLElement | null {
        return this.dp.template.playedBarWrap?.parentElement ?? null;
    }

    private onDragStart(event: Event): void {
        if (this.isBarEvent(event) === false) {
            return;
        }

        // DPlayer 標準のシーク処理を止める
        event.stopPropagation();
        event.preventDefault();

        this.isPausedBeforeDrag = this.dp.video.paused;
        this.dragPercentage = this.getPercentage(event);
        this.dp.container.classList.add('dplayer-seeking');
        if (this.dp.video.paused === false) {
            this.dp.video.pause();
        }

        document.addEventListener('mousemove', this.dragMoveListener, { passive: false });
        document.addEventListener('touchmove', this.dragMoveListener, { passive: false });
        document.addEventListener('mouseup', this.dragEndListener);
        document.addEventListener('touchend', this.dragEndListener);

        this.update();
        this.updateBarTime(this.dragPercentage);
    }

    private onDragMove(event: Event): void {
        if (this.dragPercentage === null) {
            return;
        }

        event.preventDefault();
        this.dragPercentage = this.getPercentage(event);
        this.update();
        this.updateBarTime(this.dragPercentage);
    }

    private onDragEnd(event: Event): void {
        if (this.dragPercentage === null) {
            return;
        }

        const percentage = this.getPercentage(event, this.dragPercentage);
        this.dragPercentage = null;
        this.removeDragListeners();
        this.dp.container.classList.remove('dplayer-seeking');

        this.source.setCurrentTime(percentage * this.source.getDuration());
        if (this.isPausedBeforeDrag === false) {
            this.dp.video.play().catch(() => {
                // 自動再生がブロックされた場合は何もしない
            });
        }

        this.update();
    }

    private removeDragListeners(): void {
        document.removeEventListener('mousemove', this.dragMoveListener);
        document.removeEventListener('touchmove', this.dragMoveListener);
        document.removeEventListener('mouseup', this.dragEndListener);
        document.removeEventListener('touchend', this.dragEndListener);
    }

    /**
     * シークバーにカーソルを合わせたときのプレビュー時刻を仮想タイムラインの値に直す
     */
    private onHover(event: Event): void {
        if (this.isBarEvent(event) === false || this.dragPercentage !== null) {
            return;
        }

        this.updateBarTime(this.getPercentage(event));
    }

    private updateBarTime(percentage: number): void {
        const barTime = this.dp.template.playedBarTime;
        if (typeof barTime === 'undefined' || barTime === null) {
            return;
        }

        barTime.textContent = VirtualTimeline.secondToTime(percentage * this.source.getDuration());
    }

    /**
     * シークバー上のイベントか
     */
    private isBarEvent(event: Event): boolean {
        const barWrap = this.dp.template.playedBarWrap;

        return typeof barWrap !== 'undefined' && barWrap !== null && event.target instanceof Node && barWrap.contains(event.target) === true;
    }

    /**
     * イベントの x 座標からシークバー上の位置 (0.0 ~ 1.0) を求める
     * @param event: Event
     * @param defaultValue: number 座標を取得できなかった場合の値
     * @return number
     */
    private getPercentage(event: Event, defaultValue: number = 0): number {
        const barWrap = this.dp.template.playedBarWrap;
        if (typeof barWrap === 'undefined' || barWrap === null) {
            return defaultValue;
        }

        const clientX = VirtualTimeline.getClientX(event);
        if (clientX === null) {
            return defaultValue;
        }

        const rect = barWrap.getBoundingClientRect();
        if (rect.width <= 0) {
            return defaultValue;
        }

        return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    }

    /**
     * 動画全体の時間軸と video 要素の時間軸の差分 (現在のストリームの開始位置) を返す
     * @return number
     */
    private getBaseTime(): number {
        const videoCurrentTime = this.dp.video.currentTime;

        return this.source.getCurrentTime() - (isFinite(videoCurrentTime) === true ? videoCurrentTime : 0);
    }

    private static getClientX(event: Event): number | null {
        if ('touches' in event) {
            const touchEvent = event as TouchEvent;
            if (touchEvent.touches.length > 0) {
                return touchEvent.touches[0].clientX;
            }
            if (touchEvent.changedTouches.length > 0) {
                return touchEvent.changedTouches[0].clientX;
            }

            return null;
        }

        return 'clientX' in event ? (event as MouseEvent).clientX : null;
    }

    private static toPercentage(time: number, duration: number): number {
        if (duration <= 0 || isFinite(time) === false) {
            return 0;
        }

        return Math.min(Math.max(time / duration, 0), 1);
    }

    /**
     * 秒を mm:ss / hh:mm:ss 形式にする (DPlayer の表示に合わせる)
     * @param time: number 秒
     * @return string
     */
    private static secondToTime(time: number): string {
        if (isFinite(time) === false || time < 0) {
            return '00:00';
        }

        const total = Math.floor(time);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`);

        return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    }
}
