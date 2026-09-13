/**
 * 音声トラック切替 UI を表示できる件数か判定する。
 * @param trackCount 音声トラック数
 * @return boolean 2 件以上なら true
 */
export const isAudioTrackSwitcherVisible = (trackCount: number): boolean => trackCount >= 2;
