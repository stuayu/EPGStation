export type PlaybackSeekAction = 'play' | 'pause' | 'preserve';

/**
 * シーク完了後に適用する再生状態を返す。
 * @param resume シーク前に再生中なら true、一時停止中なら false、省略時は現在状態を保持
 * @return PlaybackSeekAction
 */
export const resolvePlaybackSeekAction = (resume?: boolean): PlaybackSeekAction => {
    if (resume === true) return 'play';
    if (resume === false) return 'pause';

    return 'preserve';
};

/**
 * シーク完了後の再生状態を適用する。
 * @param resume シーク前の再生状態
 * @param actions 再生・一時停止処理
 * @return void
 */
export const applyPlaybackSeekAction = (
    resume: boolean | undefined,
    actions: { play: () => void; pause: () => void },
): void => {
    const action = resolvePlaybackSeekAction(resume);
    if (action === 'play') actions.play();
    else if (action === 'pause') actions.pause();
};
