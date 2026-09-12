import { DPlayerType } from 'dplayer';
import * as apid from '../../../api';
import {
    getDPlayerAudioValue,
    selectAudioTrackIndex,
} from '../../../src/util/DPlayerAudioTrackUtil';

/**
 * DPlayer (tsukumijima フォーク) の標準 UI へ EPGStation 固有の機能を差し込むユーティリティ。
 *
 * DPlayer は音声切替 UI (設定 > 音声) を持っているが、その中身は
 * mpegts.js の switchPrimaryAudio() / hls.js の audioTracks を直接叩く実装で、
 * 「サーバー側でストリームを作り直して音声トラックを変える」EPGStation の方式には使えない。
 * そこで**パネルの DOM だけを流用**し、項目の生成とクリック時の動作をこちらで差し替える。
 *
 * DPlayer の内部 DOM に触るため、参照するクラス名は DPlayer の実装に依存する
 * (dplayer-setting-audio-panel / dplayer-setting-audio-item / dplayer-no-audio-switching)。
 * DPlayer を更新したときはここが壊れていないか確認すること。
 */
namespace DPlayerEnhancer {
    // 音声トラックが 1 つ以下のときに DPlayer が付ける「音声切替を隠す」クラス
    const NO_AUDIO_SWITCHING_CLASS = 'dplayer-no-audio-switching';
    // 選択中の音声トラック項目に付くクラス
    const AUDIO_CURRENT_CLASS = 'dplayer-setting-audio-current';
    const AUDIO_SWITCHER_STATE = Symbol('epgStationAudioSwitcherState');
    const ARIBB24_GUARDED = Symbol('epgStationAribb24Guarded');

    interface AudioTrackSwitcherState {
        option: AudioTrackSwitchOption;
        onQualityEnd: () => void;
    }

    export interface AudioTrackSwitchOption {
        // 表示する音声トラック一覧 (2 件未満なら切替 UI は出さない)
        tracks: apid.VideoAudioTrack[];
        // 現在選択中のトラック指定子
        current: apid.AudioTrackSpecifier;
        // 選択時に呼ばれる。切替に失敗した場合は例外を投げる
        onSelect: (track: apid.AudioTrackSpecifier) => Promise<void>;
    }

    /**
     * DPlayer の設定 > 音声パネルを EPGStation の音声トラック一覧で置き換える
     * @param dp: any DPlayer インスタンス
     * @param option: AudioTrackSwitchOption
     */
    export const applyAudioTrackSwitcher = (dp: any, option: AudioTrackSwitchOption): void => {
        const container: HTMLElement | undefined = dp?.container;
        const panel: HTMLElement | null | undefined = container?.querySelector('.dplayer-setting-audio-panel');
        if (typeof container === 'undefined' || panel === null || typeof panel === 'undefined') {
            return;
        }

        getAudioTrackSwitcherState(dp, option);

        // 選べるトラックが 1 つしかない場合は切替 UI を出さない。ただし標準項目が
        // 残っていれば、DPlayer の quality_end が読む選択要素を必ず1つ維持する。
        if (option.tracks.length < 2) {
            container.classList.add(NO_AUDIO_SWITCHING_CLASS);
            syncAudioCurrentItems(panel, option);

            return;
        }

        // ヘッダー (戻るボタン) は DPlayer 側の実装をそのまま使うため、項目だけを差し替える
        for (const item of Array.from(panel.querySelectorAll('.dplayer-setting-audio-item'))) {
            item.remove();
        }

        const checkIcon = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>';
        const selectedIndex = selectAudioTrackIndex(option.tracks, option.current);
        if (selectedIndex >= 0 && option.tracks[selectedIndex].track !== option.current) {
            option.current = option.tracks[selectedIndex].track;
        }

        for (const track of option.tracks) {
            const item = document.createElement('div');
            item.className = 'dplayer-setting-audio-item';
            item.dataset.audioTrack = track.track;
            // EPGStation の onSelect と DPlayer 標準の画質復元は別経路だが、DPlayer の
            // quality 切替完了処理は dataset.audio を読む。両方が同じ選択状態を見られるよう
            // 独自指定子は audioTrack に残し、DPlayer 用の primary / secondary も併記する。
            item.dataset.audio = getDPlayerAudioValue(track.track);
            item.innerHTML = `<div class="dplayer-toggle">${checkIcon}</div><span class="dplayer-label"></span>`;
            const label = item.querySelector('.dplayer-label');
            if (label !== null) {
                // 表示名はサーバー由来なので textContent で入れる (HTML として解釈させない)
                label.textContent = track.name;
            }
            panel.appendChild(item);

            item.addEventListener('click', () => {
                void selectAudioTrack(dp, panel, option, track);
            });
        }

        syncAudioCurrentItems(panel, option);

        // 現在の選択をパネルの外 (設定一覧の「音声」行) にも反映する
        updateAudioValueLabel(dp, option.tracks, option.current);
        container.classList.remove(NO_AUDIO_SWITCHING_CLASS);
        // パネルの高さはトラック数で変わるため、DPlayer が使う CSS 変数を更新する
        container.style.setProperty('--audio-length', option.tracks.length.toString(10));
    };

    /**
     * quality_end が毎回参照する DPlayer の速度選択要素を1つ保証する。
     * @param dp: any DPlayer インスタンス
     */
    export const ensureSpeedCurrent = (dp: any): void => {
        const templateItems = dp?.template?.speedItem;
        const items: HTMLElement[] = Array.isArray(templateItems)
            ? templateItems
            : Array.from(dp?.container?.querySelectorAll('.dplayer-setting-speed-item') ?? []);
        if (items.length === 0) {
            return;
        }

        const rate = Number(dp?.video?.playbackRate);
        const selectedIndex = items.findIndex(item => Number.parseFloat(item.dataset.speed ?? '') === rate);
        const index = selectedIndex >= 0 ? selectedIndex : 0;
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle('dplayer-setting-speed-current', i === index);
        }
    };

    /**
     * 画質切替直後、video の寸法がまだ 0 の間に aribb24.js が描画しないようにする。
     * ライブラリ本体は変更せず、DPlayer が生成した各 renderer の入力入口だけを抑制する。
     * @param dp: any DPlayer インスタンス
     * @param video: HTMLVideoElement 新しい video 要素
     */
    export const guardAribb24Renderers = (dp: any, video: HTMLVideoElement): void => {
        for (const key of ['aribb24Caption', 'aribb24Superimpose']) {
            const renderer = dp?.plugins?.[key];
            if (renderer === null || typeof renderer === 'undefined' || renderer[ARIBB24_GUARDED] === true) {
                continue;
            }

            for (const methodName of ['pushID3v2Data', 'pushID3v2Cue', 'refresh']) {
                const original = renderer[methodName];
                if (typeof original !== 'function') {
                    continue;
                }
                renderer[methodName] = (...args: unknown[]): unknown => {
                    const outputCanvases = [renderer.getViewCanvas?.(), renderer.getRawCanvas?.()].filter(
                        (canvas): canvas is HTMLCanvasElement => canvas !== null && typeof canvas !== 'undefined',
                    );
                    if (
                        video.videoWidth <= 0 ||
                        video.videoHeight <= 0 ||
                        outputCanvases.some(canvas => canvas.width <= 0 || canvas.height <= 0)
                    ) {
                        return false;
                    }

                    return original.apply(renderer, args);
                };
            }
            renderer[ARIBB24_GUARDED] = true;
        }
    };

    /** DPlayer の音声項目を現在値に合わせ、選択中を必ず1つだけにする。 */
    const syncAudioCurrentItems = (panel: HTMLElement, option: AudioTrackSwitchOption): void => {
        const items = Array.from(panel.querySelectorAll<HTMLElement>('.dplayer-setting-audio-item'));
        if (items.length === 0) {
            return;
        }

        const desiredAudio = getDPlayerAudioValue(option.current);
        const trackIndex = selectAudioTrackIndex(option.tracks, option.current);
        const standardIndex = items.findIndex(item => item.dataset.audio === desiredAudio);
        const preferredIndex = option.tracks.length >= 2 && trackIndex >= 0 ? trackIndex : standardIndex;
        const selectedIndex = preferredIndex >= 0 && preferredIndex < items.length ? preferredIndex : 0;

        for (let i = 0; i < items.length; i++) {
            if (typeof items[i].dataset.audio === 'undefined' || items[i].dataset.audio === '') {
                items[i].dataset.audio = i === 1 ? 'secondary' : 'primary';
            }
            items[i].classList.toggle(AUDIO_CURRENT_CLASS, i === selectedIndex);
        }
    };

    /** quality_end の購読を重複させず、再構築後の音声項目へ選択状態を戻す。 */
    const getAudioTrackSwitcherState = (dp: any, option: AudioTrackSwitchOption): AudioTrackSwitcherState => {
        const existing = dp[AUDIO_SWITCHER_STATE] as AudioTrackSwitcherState | undefined;
        if (typeof existing !== 'undefined') {
            existing.option = option;
            return existing;
        }

        const state = {} as AudioTrackSwitcherState;
        state.option = option;
        state.onQualityEnd = (): void => {
            const panel = dp?.container?.querySelector('.dplayer-setting-audio-panel') as HTMLElement | null | undefined;
            if (panel === null || typeof panel === 'undefined') {
                return;
            }
            syncAudioCurrentItems(panel, state.option);
            updateAudioValueLabel(dp, state.option.tracks, state.option.current);
        };
        dp.on?.('quality_end', state.onQualityEnd);
        dp[AUDIO_SWITCHER_STATE] = state;

        return state;
    };

    /**
     * 音声トラックを選択する
     * @param dp: any
     * @param panel: HTMLElement
     * @param option: AudioTrackSwitchOption
     * @param track: apid.VideoAudioTrack
     */
    const selectAudioTrack = async (
        dp: any,
        panel: HTMLElement,
        option: AudioTrackSwitchOption,
        track: apid.VideoAudioTrack,
    ): Promise<void> => {
        if (track.track === option.current) {
            return;
        }

        dp?.notice?.(`音声を ${track.name} に切り替えています…`, -1);

        try {
            await option.onSelect(track.track);
        } catch (err) {
            console.error(err);
            dp?.notice?.('音声の切り替えに失敗しました', 3000);

            return;
        }

        option.current = track.track;
        syncAudioCurrentItems(panel, option);
        updateAudioValueLabel(dp, option.tracks, track.track);
        dp?.notice?.(`音声: ${track.name}`, 2000);
        dp?.setting?.hide?.();
    };

    /**
     * 設定一覧の「音声」行に現在のトラック名を表示する
     * @param dp: any
     * @param tracks: apid.VideoAudioTrack[]
     * @param current: apid.AudioTrackSpecifier
     */
    const updateAudioValueLabel = (dp: any, tracks: apid.VideoAudioTrack[], current: apid.AudioTrackSpecifier): void => {
        const value: HTMLElement | undefined = dp?.template?.audioValue;
        if (typeof value === 'undefined' || value === null) {
            return;
        }

        const track = tracks.find(t => t.track === current);
        value.textContent = typeof track === 'undefined' ? '' : track.name;
    };

    /**
     * チャプターを DPlayer のシークバー上のマーカー (highlight) へ変換する
     * @param chapters: apid.VideoChapter[]
     * @param duration: number 動画全体の長さ (秒)。0 以下なら空配列を返す
     * @return DPlayerType.HighlightItem[]
     */
    export const buildChapterHighlights = (
        chapters: apid.VideoChapter[],
        duration: number,
    ): DPlayerType.HighlightItem[] => {
        if (duration <= 0) {
            return [];
        }

        return chapters
            .filter(chapter => chapter.startAt >= 0 && chapter.startAt < duration)
            .map((chapter, index) => ({
                text: chapter.title ?? `チャプター ${index + 1}`,
                time: chapter.startAt,
            }));
    };

    export interface ChapterNavigation {
        // チャプター一覧 (開始位置の昇順)
        chapters: apid.VideoChapter[];
        // 現在の再生位置 (秒) を返す
        getCurrentTime: () => number;
        // 指定位置 (秒) へシークする
        seek: (time: number) => void;
    }

    /**
     * 次のチャプターの開始位置へ移動する
     * @param nav: ChapterNavigation
     * @return boolean 移動先があった場合 true
     */
    export const seekToNextChapter = (nav: ChapterNavigation): boolean => {
        const current = nav.getCurrentTime();
        const next = nav.chapters.find(chapter => chapter.startAt > current + 0.5);
        if (typeof next === 'undefined') {
            return false;
        }

        nav.seek(next.startAt);

        return true;
    };

    /**
     * 現在のチャプターの先頭 (再生位置が先頭付近なら 1 つ前のチャプター) へ移動する
     * @param nav: ChapterNavigation
     * @return boolean 移動先があった場合 true
     */
    export const seekToPreviousChapter = (nav: ChapterNavigation): boolean => {
        const current = nav.getCurrentTime();
        // 直前 2 秒以内に開始したチャプターの先頭に居るときは、さらに 1 つ前へ戻す
        const candidates = nav.chapters.filter(chapter => chapter.startAt < current - 2);
        const target = candidates.length === 0 ? null : candidates[candidates.length - 1];
        if (target === null) {
            return false;
        }

        nav.seek(target.startAt);

        return true;
    };

    /**
     * 再生位置が含まれるチャプターを返す
     * @param chapters: apid.VideoChapter[]
     * @param time: number 秒
     * @return apid.VideoChapter | null
     */
    export const findChapterAt = (chapters: apid.VideoChapter[], time: number): apid.VideoChapter | null => {
        for (let i = chapters.length - 1; i >= 0; i--) {
            if (chapters[i].startAt <= time) {
                return chapters[i];
            }
        }

        return null;
    };
}

export default DPlayerEnhancer;
