/**
 * 録画実況の再生位置を実況時刻へ変換する。
 *
 * `startAt` は番組開始時刻ではなく、録画ファイルの先頭に対応する実時刻。
 * 録画ストリームを作り直している間のダミー再生位置は実況同期へ使わない。
 */
export const resolveRecordedJikkyoPlaybackTime = (
    playbackTime: number | null | undefined,
    isDummy: boolean = false,
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
 * 録画再生位置に対応する実況の実時刻を返す
 * @param startAt 録画ファイル先頭の実時刻 (UNIX 時刻・ミリ秒)
 * @param playbackTime VirtualTimeline 上の絶対再生位置 (秒)
 * @return number | null
 */
export const resolveRecordedJikkyoTimestamp = (
    startAt: number,
    playbackTime: number | null | undefined,
): number | null => {
    if (
        Number.isFinite(startAt) === false ||
        typeof playbackTime !== 'number' ||
        Number.isFinite(playbackTime) === false ||
        playbackTime < 0
    ) {
        return null;
    }

    return startAt + playbackTime * 1000;
};

/**
 * 録画再生位置以降の最初の実況コメントの index を二分探索する
 * @param comments 時刻昇順の実況コメント
 * @param startAt 録画ファイル先頭の実時刻 (UNIX 時刻・ミリ秒)
 * @param playbackTime VirtualTimeline 上の絶対再生位置 (秒)
 * @return number
 */
export const findRecordedJikkyoCommentIndex = <T extends { timestamp: number }>(
    comments: T[],
    startAt: number,
    playbackTime: number | null | undefined,
): number => {
    const targetTimestamp = resolveRecordedJikkyoTimestamp(startAt, playbackTime);
    if (targetTimestamp === null) {
        return 0;
    }

    let low = 0;
    let high = comments.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (comments[mid].timestamp < targetTimestamp) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return low;
};
