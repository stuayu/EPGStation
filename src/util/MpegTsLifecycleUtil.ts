export type MpegTsLifecycleAction = 'create' | 'reset' | 'defer';

export interface MpegTsPlayerLike {
    _media_element?: object | null;
    destroy?: () => void;
}

export interface DPlayerMediaBackendLike {
    mediaBackendDestroy?: (() => void) | null;
    destroyMediaBackend?: () => void;
    plugins?: Record<string, unknown>;
}

export interface DPlayerMpegTsPluginsLike {
    mpegts?: unknown;
    aribb24Caption?: unknown;
    aribb24Superimpose?: unknown;
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
 * 同じ video 要素へ切り替える前に DPlayer の旧 media backend を破棄する。
 * DPlayer 1.33 は mediaBackendDestroy をクロージャで保持しているため、
 * mpegts.js の destroy() を直接呼んではいけない。destroyMediaBackend() を呼ぶと
 * DPlayer 自身が callback を1回実行して参照も null にする。
 *
 * @param mpegtsPlayer 旧 mpegts.js インスタンス
 * @param nextMediaElement 切替先の video 要素
 * @param dplayer DPlayer 本体 (1.33 以降)
 * @return true なら呼び出し側が旧インスタンスの参照を外す
 */
export const destroyMpegtsBeforeVideoReuse = (
    mpegtsPlayer: MpegTsPlayerLike | null | undefined,
    nextMediaElement: object,
    dplayer?: DPlayerMediaBackendLike,
): boolean => {
    if (mpegtsPlayer === null || typeof mpegtsPlayer === 'undefined') return false;
    if (decideMpegTsLifecycle(mpegtsPlayer, nextMediaElement) !== 'reset') return false;

    if (typeof dplayer?.destroyMediaBackend === 'function' && typeof dplayer.mediaBackendDestroy === 'function')
        dplayer.destroyMediaBackend();
    else mpegtsPlayer.destroy?.();

    return true;
};

/**
 * DPlayer の旧 mediaBackendDestroy callback を、新 backend 初期化前に退避する。
 * DPlayer 1.33 の initMSE() は先頭で destroyMediaBackend() を呼ぶため、
 * ここで null にしないと defer の意図に反して旧 backend が即時破棄される。
 *
 * @param dplayer DPlayer 本体
 * @return 退避した旧 callback。存在しない場合は null
 */
export const takeDPlayerMediaBackendDestroy = (dplayer: DPlayerMediaBackendLike): (() => void) | null => {
    const destroy = typeof dplayer.mediaBackendDestroy === 'function' ? dplayer.mediaBackendDestroy : null;
    dplayer.mediaBackendDestroy = null;

    return destroy;
};

/**
 * 退避した DPlayer callback を、旧 plugin 参照へ一時的に差し替えて実行する。
 * DPlayer 1.33 の callback は mpegts.js 本体をクロージャで保持する一方、
 * renderer と plugin map は this.plugins を参照するため、新個体を誤って破棄させない。
 *
 * @param dplayer DPlayer 本体
 * @param destroy 退避した旧 callback
 * @param previousPlugins 旧 mpegts.js / renderer の参照
 * @return void
 */
export const destroyDeferredDPlayerMediaBackend = (
    dplayer: DPlayerMediaBackendLike,
    destroy: (() => void) | null,
    previousPlugins: DPlayerMpegTsPluginsLike,
): void => {
    if (destroy === null) return;

    const plugins = dplayer.plugins;
    if (typeof plugins === 'undefined') {
        destroy();

        return;
    }

    const currentPlugins: DPlayerMpegTsPluginsLike = {
        mpegts: plugins.mpegts,
        aribb24Caption: plugins.aribb24Caption,
        aribb24Superimpose: plugins.aribb24Superimpose,
    };
    Object.assign(plugins, previousPlugins);
    try {
        destroy();
    } finally {
        Object.assign(plugins, currentPlugins);
    }
};
