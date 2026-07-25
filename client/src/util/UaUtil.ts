namespace UaUtil {
    /**
     * UA が iPadOS か判定
     */
    export const isiPadOS = (): boolean => {
        return /iPad|Macintosh|macintosh/.test(navigator.userAgent) === true && 'ontouchend' in document;
    };

    /**
     * UA が iOS か判定
     * @return boolean
     */
    export const isiOS = (): boolean => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || isiPadOS();
    };

    /**
     * UA が iPhone か判定
     */
    export const isiPhone = (): boolean => {
        return /iPhone|iphone/.test(navigator.userAgent);
    };

    /**
     * UA が Android か判定
     * @return boolean
     */
    export const isAndroid = (): boolean => {
        return /Android|android/.test(navigator.userAgent);
    };

    /**
     * UA が Edge か判定
     * @return boolean
     */
    export const isEdge = (): boolean => {
        return /Edge|edge/.test(navigator.userAgent);
    };

    /**
     * UA が IE か判定
     * @return boolean
     */
    export const isIE = (): boolean => {
        return /msie|MSIE/.test(navigator.userAgent) || /Trident/.test(navigator.userAgent);
    };

    /**
     * UA が Chrome か判定
     * @return boolean
     */
    export const isChrome = (): boolean => {
        return /chrome|Chrome/.test(navigator.userAgent);
    };

    /**
     * UA が Firefox か判定
     * @return boolean
     */
    export const isFirefox = (): boolean => {
        return /firefox|Firefox/.test(navigator.userAgent);
    };

    /**
     * UA が Safari か判定
     * @return boolean
     */
    export const isSafari = (): boolean => {
        return /safari|Safari/.test(navigator.userAgent) && !isChrome();
    };

    /**
     * UA が Safari 10+ か判定
     * @return boolean
     */
    export const isSafari10OrLater = (): boolean => {
        return isSafari() && /Version\/1\d/i.test(navigator.userAgent);
    };

    /**
     * UA が Mobile か判定
     * @return boolean
     */
    export const isMobile = (): boolean => {
        return /Mobile|mobile/.test(navigator.userAgent);
    };

    /**
     * UA が macOS か判定
     * @return boolean
     */
    export const isMac = (): boolean => {
        return /Macintosh|macintosh/.test(navigator.userAgent) && isiPadOS() === false;
    };

    /**
     * UA が Windows か判定
     * @return boolean
     */
    export const isWindows = (): boolean => {
        return /Windows|windows/.test(navigator.userAgent);
    };

    /**
     * Safari (WebKit) のメジャーバージョンを返す
     * UA の Version/XX トークンから取得するため、「ホーム画面に追加」した
     * Web App (UA に Safari トークンが含まれない) でも判定できる
     * @return number | null 取得できない場合は null
     */
    export const safariMajorVersion = (): number | null => {
        const match = navigator.userAgent.match(/Version\/(\d+)/);

        return match === null ? null : parseInt(match[1], 10);
    };

    /**
     * 「ホーム画面に追加」した Web App (standalone モード) として起動しているか判定
     * @return boolean
     */
    export const isStandalonePWA = (): boolean => {
        return (
            (window.navigator as any).standalone === true ||
            (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches === true)
        );
    };
}

export default UaUtil;
