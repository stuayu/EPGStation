export type MpegTsLifecycleAction = 'create' | 'reset' | 'defer';

export interface MpegTsPlayerLike {
    _media_element?: object | null;
    destroy?: () => void;
}

/**
 * mpegts.js の切替方法を決める。
 * 同じ video 要素は MediaSource / SourceBuffer / currentTime の時間軸を持つため、
 * URL が同じ場合も旧プレイヤーを即時破棄して新しい時間軸を作る。
 * 別要素の画質切替だけは、旧プレイヤーを新側の準備完了まで保持する。
 *
 * @param previousMpegts 旧 mpegts.js インスタンス
 * @param nextMediaElement 新 mpegts.js が使う video 要素
 * @return 切替方法
 */
export const decideMpegTsLifecycle = (
    previousMpegts: MpegTsPlayerLike | null | undefined,
    nextMediaElement: object,
): MpegTsLifecycleAction => {
    if (previousMpegts === null || typeof previousMpegts === 'undefined') return 'create';

    // _media_element を取得できない実装も安全側 (即時破棄) に倒す。
    if (previousMpegts._media_element === null || typeof previousMpegts._media_element === 'undefined') return 'reset';
    return previousMpegts._media_element === nextMediaElement ? 'reset' : 'defer';
};

/**
 * mpegts.js の旧プレイヤーを新しい video の準備完了まで保持できるか判定する。
 *
 * @param previousMediaElement 旧 mpegts.js が保持している video 要素
 * @param nextMediaElement 新 mpegts.js が使う video 要素
 * @return true なら旧プレイヤーを一時保持できる
 */
export const shouldDeferMpegtsDestroy = (
    previousMediaElement: object | null | undefined,
    nextMediaElement: object,
): boolean =>
    decideMpegTsLifecycle(
        previousMediaElement === null || typeof previousMediaElement === 'undefined'
            ? null
            : { _media_element: previousMediaElement },
        nextMediaElement,
    ) === 'defer';

/**
 * 同じ video 要素へ切り替える前に旧 mpegts.js を破棄する。
 * DPlayer の switchVideo() はこの後に video.src を設定するため、src 消去の競合を防げる。
 *
 * @param mpegtsPlayer 旧 mpegts.js インスタンス
 * @param nextMediaElement 切替先の video 要素
 * @return true なら呼び出し側が旧インスタンスの参照を外す
 */
export const destroyMpegtsBeforeVideoReuse = (
    mpegtsPlayer: MpegTsPlayerLike | null | undefined,
    nextMediaElement: object,
): boolean => {
    if (mpegtsPlayer === null || typeof mpegtsPlayer === 'undefined') return false;
    if (decideMpegTsLifecycle(mpegtsPlayer, nextMediaElement) !== 'reset') return false;

    mpegtsPlayer.destroy?.();

    return true;
};
