import Mpegts from 'mpegts.js';
import { supportsWorkerMediaSource } from 'mpeg2toh264/player';
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
     * - macOS Safari 26 以降で映像が停止していた不具合は、mpegts.js を tsukumijima フォーク
     *   (音声タイムスタンプのギャップ補完が Safari でも有効) へ固定したことで解消したため無効化しない
     *   (実測: WebKit 26 でライブ M2TS-LL を 6 分間連続再生して停止なし)
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

    /** MPEG-2 TS を mpeg2toh264 で端末変換できるか判定する。 */
    export const checkMpeg2ToH264Support = (): M2TSLLSupportResult => {
        const hasMainMse =
            typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"');
        if (supportsWorkerMediaSource() === false && hasMainMse === false) {
            return { isSupported: false, reason: 'MPEG-2 端末変換に対応していないブラウザーです。' };
        }
        return { isSupported: true, reason: null };
    };

    export const isMpeg2ToH264Supported = (): boolean => checkMpeg2ToH264Support().isSupported;

    /**
     * 録画の MP4 / WebM 配信 (プログレッシブ再生) が利用可能か判定する
     *
     * 録画の MP4 / WebM はエンコーダの出力をそのまま流す chunked 配信で、
     * `Content-Length` も `Accept-Ranges` も返せない。WebKit (iOS / iPadOS / macOS Safari) は
     * progressive な MP4 を Range 要求で読むため、この配信を再生できず
     * `MediaError code 4` で失敗する (**コーデックの問題ではない**)。
     *
     * 実測 (iPad Mini / WebKit、本番の録画 MP4 の実データ):
     * - 同じバイト列を Content-Length + Range 対応で配ると再生できる (1920x1080 / readyState 4)
     * - Content-Length 無しの chunked で配ると HEVC も H.264 も `MediaError 4` になる
     *
     * WebM は WebKit がそもそもデコードできない。
     * @return boolean
     */
    export const isProgressiveFileStreamSupported = (): boolean => {
        return UaUtil.isWebKitEngine() === false;
    };
}

export default StreamSupportUtil;
