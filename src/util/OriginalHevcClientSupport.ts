/**
 * 無変換 HEVC (original-hevc) を端末側で再生できるかの判定。
 *
 * 判定材料をすべて引数で受け取る純粋関数にしてあるのは、ブラウザ API
 * (`Mpegts.getFeatureList()` / UA) に依存せずテストで固定するため。
 */

export interface OriginalHevcClientSupportInput {
    /** mpegts.js が HEVC を MSE / MMS へ transmux できるか */
    mseH265Playback: boolean;
    /** WebKit (iOS / iPadOS / macOS Safari) か */
    isWebKitEngine: boolean;
    /** 素材のビット深度。分からない場合は undefined */
    sourceBitDepth?: number;
}

export interface OriginalHevcClientSupportResult {
    isSupported: boolean;
    reason: string | null;
}

/** mpegts.js が HEVC を扱えない端末向けの理由 */
export const UNSUPPORTED_HEVC_REASON = 'HEVC MPEG-TS の端末再生に対応していないブラウザーです。';
/** WebKit で 10bit の無変換再生を避けるときの理由 */
export const WEBKIT_MAIN10_REASON =
    'この端末では 10bit HEVC の無変換再生がコマ送りになるため、変換した画質で再生してください。';

/**
 * 無変換 HEVC を端末で再生してよいか判定する。
 *
 * ここで扱う WebKit の 10bit 問題は、オンラインの無変換再生がコマ送りになる理由。
 * オフライン保存の黒画面は Service Worker の Range 応答が 416 になった別問題。
 *
 * **WebKit は 10bit (Main 10) の HEVC を MSE 経由で実時間デコードできない。**
 * `MediaSource.isTypeSupported()` も `video.canPlayType()` も「対応」と答えるため、
 * 能力判定だけでは弾けない。
 *
 * 実測 (2026-09-16):
 * - iPad で 1440x1080 / HEVC Main 10 / 29.97fps の録画を無変換再生するとコマ送りになる。
 *   同じ録画を ffmpeg で 8bit へ変換する HLS 経路にすると滑らかに再生できる
 * - 同じ素材を PC の Chrome で fMP4 へ remux して直接再生すると描画間隔 0.033s が 78/89 回、
 *   平均 30.5fps。**素材・配信・mpegts.js のいずれにも問題はない**
 *
 * ネイティブ HLS 経由の 10bit (4K HDR 等) は WebKit でも再生できるため、
 * ここで落とすのは MSE へ直接流す無変換 HEVC だけにする。
 * @param input: OriginalHevcClientSupportInput
 * @return OriginalHevcClientSupportResult
 */
export const checkOriginalHevcClientSupport = (
    input: OriginalHevcClientSupportInput,
): OriginalHevcClientSupportResult => {
    if (input.mseH265Playback !== true) {
        return { isSupported: false, reason: UNSUPPORTED_HEVC_REASON };
    }
    if (input.sourceBitDepth === 10 && input.isWebKitEngine === true) {
        return { isSupported: false, reason: WEBKIT_MAIN10_REASON };
    }

    return { isSupported: true, reason: null };
};

export default { checkOriginalHevcClientSupport, UNSUPPORTED_HEVC_REASON, WEBKIT_MAIN10_REASON };
