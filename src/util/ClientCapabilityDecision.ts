/** ブラウザーの実際の HLS/MSE 経路に合わせた codec 判定入力。 */
export interface DecodeCapabilityDecisionInput {
    /** HLS を video 要素へ直接渡す経路か。 */
    nativeHls: boolean;
    /** MediaCapabilities の decodingInfo 結果。未取得・例外時は undefined。 */
    mediaCapabilitiesSupported?: boolean;
    /** video.canPlayType() の結果。 */
    canPlayType: '' | 'maybe' | 'probably';
}

/** Safari / iOS で hls.js を使わない経路か判定する入力。 */
export interface NativeHlsDecisionInput {
    hlsCanPlayType: '' | 'maybe' | 'probably';
    isIos: boolean;
    isSafari: boolean;
}

/**
 * DPlayer の HLS 経路と同じ規則でネイティブ HLS を選ぶ。
 * iOS は MSE が無く、macOS Safari は MSE があっても DPlayerUtil が native HLS を選ぶ。
 */
export const isNativeHlsPlayback = (input: NativeHlsDecisionInput): boolean =>
    input.hlsCanPlayType !== '' && (input.isIos === true || input.isSafari === true);

/**
 * codec の再生可否を判定する。
 * ネイティブ HLS では canPlayType を実際の再生経路の根拠とし、MediaCapabilities の false による誤判定を避ける。
 * MSE では MediaCapabilities を優先し、問い合わせ不能時だけ canPlayType を補助に使う。
 */
export const resolveDecodeSupport = (input: DecodeCapabilityDecisionInput): boolean => {
    if (input.nativeHls === true && input.canPlayType !== '') return true;
    if (input.mediaCapabilitiesSupported !== undefined) return input.mediaCapabilitiesSupported;

    return input.canPlayType !== '';
};

/** dynamic-range media query の結果を表示能力へ変換する。codec 能力とは独立している。 */
export const resolveDisplayCapabilities = (dynamicRangeHigh: boolean): { hdr: boolean; hlg: boolean } => ({
    hdr: dynamicRangeHigh,
    hlg: dynamicRangeHigh,
});
