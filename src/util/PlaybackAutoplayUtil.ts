/**
 * ブラウザーの自動再生制限を適用した自動再生可否を返す。
 * @param isSafari Safari かどうか
 * @param isIOS iOS かどうか
 * @return boolean
 */
export const shouldAutoplayPlayback = (isSafari: boolean, isIOS: boolean): boolean =>
    isSafari === false && isIOS === false;
