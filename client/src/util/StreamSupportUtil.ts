import Mpegts from 'mpegts.js';
import UaUtil from './UaUtil';

namespace StreamSupportUtil {
    export interface M2TSLLSupportResult {
        isSupported: boolean;
        reason: string | null;
    }

    /**
     * mpegts.js による M2TS-LL (低遅延) ライブ再生が利用可能か判定する
     *
     * - MSE (MediaSource) に加え、mpegts.js 1.8.0 以降では iOS / iPadOS
     *   Safari 17.1+ の ManagedMediaSource (MMS) を利用した再生に対応する
     * - iOS / iPadOS 26 以降の「ホーム画面に追加」した Web App (standalone) では
     *   WebKit の不具合により MSE / MMS ベースの再生が開始できないため無効化する
     *   (KonomiTV でも iOS/iPadOS 26.1 で同様の問題が報告されている)
     * - macOS Safari 26 以降は mpegts.js ライブ再生で映像が停止する既知の
     *   不具合があるため無効化し、ネイティブ HLS へ誘導する
     * @return M2TSLLSupportResult
     */
    export const checkM2TSLLSupport = (): M2TSLLSupportResult => {
        // MSE / MMS を利用したライブ再生に対応しているか
        if (Mpegts.isSupported() === false || Mpegts.getFeatureList().mseLivePlayback === false) {
            return {
                isSupported: false,
                reason: '非対応ブラウザーです。',
            };
        }

        const safariVersion = UaUtil.safariMajorVersion();

        // iOS / iPadOS 26 以降のホーム画面 Web App (standalone) は WebKit の不具合で再生不可
        if (UaUtil.isiOS() === true && UaUtil.isStandalonePWA() === true && (safariVersion === null || safariVersion >= 26)) {
            return {
                isSupported: false,
                reason: 'iOS 26 以降のホーム画面アプリでは低遅延再生できません。Safari のタブで開くか HLS で視聴してください。',
            };
        }

        // macOS Safari 26 以降は mpegts.js ライブ再生で映像が停止する
        if (UaUtil.isMac() === true && UaUtil.isSafari() === true && safariVersion !== null && safariVersion >= 26) {
            return {
                isSupported: false,
                reason: 'Safari 26 では低遅延再生に既知の不具合があるため HLS で視聴してください。',
            };
        }

        return {
            isSupported: true,
            reason: null,
        };
    };

    /**
     * M2TS-LL 再生が利用可能かのみを返す
     * @return boolean
     */
    export const isM2TSLLSupported = (): boolean => {
        return checkM2TSLLSupport().isSupported;
    };
}

export default StreamSupportUtil;
