/**
 * ManagedMediaSource の停止状態から録画ストリームを再取得する位置を返す。
 * ダミー再生位置はストリームの実位置ではないため、再取得に使わない。
 * @param playbackTime VirtualTimeline 上の絶対再生位置 (秒)
 * @param isDummy ストリーム再生成中のダミー位置か
 * @return number | null
 */
export const resolveManagedMediaSourceRecoveryPosition = (
    playbackTime: number | null | undefined,
    isDummy = false,
): number | null => {
    if (
        isDummy === true ||
        typeof playbackTime !== 'number' ||
        Number.isFinite(playbackTime) === false ||
        playbackTime < 0
    ) {
        return null;
    }

    return playbackTime;
};

/**
 * MMS の endstreaming 後に前方バッファが枯渇する状態か判定する。
 * `bufferedEnd` は現在の video.currentTime を含む範囲の末尾。別範囲しかない場合は null。
 * @param suspended MMS が endstreaming を通知したままか
 * @param currentTime 現在の MPEG-TS 時間軸 (秒)
 * @param bufferedEnd 現在位置を含むバッファ範囲の末尾 (秒)
 * @param thresholdSec 再取得を始める残りバッファ (秒)
 * @return boolean
 */
export const isManagedMediaSourceBufferStarving = (
    suspended: boolean,
    currentTime: number,
    bufferedEnd: number | null,
    thresholdSec = 8,
): boolean => {
    if (
        suspended === false ||
        Number.isFinite(currentTime) === false ||
        Number.isFinite(thresholdSec) === false ||
        thresholdSec < 0
    ) {
        return false;
    }

    return bufferedEnd === null || (Number.isFinite(bufferedEnd) && bufferedEnd - currentTime <= thresholdSec);
};
