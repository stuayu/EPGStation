export interface DPlayerAudioTrackLike {
    track: string;
}

/**
 * DPlayer の音声パネルで選択中にするトラックの添字を返す。
 * 一致するトラックが無い場合は先頭を選び、DPlayer が null の選択要素を読む状態を防ぐ。
 * @param tracks 音声トラック一覧
 * @param current 現在の音声トラック指定子
 * @return 選択する添字。空配列の場合は -1
 */
export const selectAudioTrackIndex = (tracks: readonly DPlayerAudioTrackLike[], current: string): number => {
    if (tracks.length === 0) {
        return -1;
    }

    const index = tracks.findIndex(track => track.track === current);

    return index >= 0 ? index : 0;
};

/**
 * EPGStation の音声トラック指定子を DPlayer の dataset.audio 値へ変換する。
 * @param track 音声トラック指定子
 * @return DPlayer が読む音声値
 */
export const getDPlayerAudioValue = (track: string): 'primary' | 'secondary' => {
    return track === 'sub' || (track !== 'main' && Number.parseInt(track, 10) === 1) ? 'secondary' : 'primary';
};
