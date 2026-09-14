export type PlaybackRestartReason =
    | 'live-idle'
    | 'live-stall'
    | 'media-error'
    | 'offline'
    | 'pip-resume'
    | 'manual'
    | 'quality-switch'
    | 'audio-switch';

/**
 * プレイヤー再生成後に一時停止を引き継ぐか判定する。
 * アイドル・停滞による自動再生成だけは利用者の停止意図を保持し、
 * エラー復旧・オフライン復帰・PiP 復帰・手動復旧は再生を試みる。
 */
export const shouldPreservePausedPlayback = (wasPaused: boolean, reason: PlaybackRestartReason): boolean => {
    if (reason === 'live-idle' || reason === 'live-stall') return wasPaused;
    if (reason === 'media-error' || reason === 'offline' || reason === 'pip-resume' || reason === 'manual')
        return false;
    return wasPaused;
};
