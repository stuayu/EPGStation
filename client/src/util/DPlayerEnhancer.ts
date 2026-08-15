import { DPlayerType } from 'dplayer';
import * as apid from '../../../api';

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

        // 選べるトラックが 1 つしかない場合は切替 UI を出さない
        if (option.tracks.length < 2) {
            container.classList.add(NO_AUDIO_SWITCHING_CLASS);

            return;
        }

        // ヘッダー (戻るボタン) は DPlayer 側の実装をそのまま使うため、項目だけを差し替える
        for (const item of Array.from(panel.querySelectorAll('.dplayer-setting-audio-item'))) {
            item.remove();
        }

        const checkIcon = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>';
        for (const track of option.tracks) {
            const item = document.createElement('div');
            item.className = `dplayer-setting-audio-item${track.track === option.current ? ` ${AUDIO_CURRENT_CLASS}` : ''}`;
            item.dataset.audioTrack = track.track;
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

        // 現在の選択をパネルの外 (設定一覧の「音声」行) にも反映する
        updateAudioValueLabel(dp, option.tracks, option.current);
        container.classList.remove(NO_AUDIO_SWITCHING_CLASS);
        // パネルの高さはトラック数で変わるため、DPlayer が使う CSS 変数を更新する
        container.style.setProperty('--audio-length', option.tracks.length.toString(10));
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
        for (const item of Array.from(panel.querySelectorAll('.dplayer-setting-audio-item'))) {
            item.classList.toggle(AUDIO_CURRENT_CLASS, (item as HTMLElement).dataset.audioTrack === track.track);
        }
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
