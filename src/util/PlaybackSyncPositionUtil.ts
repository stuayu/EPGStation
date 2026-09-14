/** video.currentTime へ同期してよい非負の有限値か判定する。 */
export const isValidPlaybackSyncPosition = (position: number): boolean => Number.isFinite(position) && position >= 0;
