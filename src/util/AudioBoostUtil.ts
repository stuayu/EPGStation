/** 配信用音声ブースト倍率の既定値 */
export const DEFAULT_AUDIO_BOOST = 2.0;

/** 配信用音声ブースト倍率の下限 */
export const MIN_AUDIO_BOOST = 1.0;

/** 配信用音声ブースト倍率の上限 */
export const MAX_AUDIO_BOOST = 4.0;

/**
 * 音声ブースト倍率を有効な範囲へ正規化する。
 * @param value: unknown 設定値
 * @return number 1.0〜4.0 の倍率
 */
export const normalizeAudioBoost = (value: unknown): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        return DEFAULT_AUDIO_BOOST;
    }

    return Math.min(MAX_AUDIO_BOOST, Math.max(MIN_AUDIO_BOOST, value));
};

/**
 * 音声ブーストの ffmpeg フィルタ式を返す。
 * 他のフィルタ (副音声の pan など) と 1 本の -af へ連結するために、オプション名を含めない形で返す
 * @param value: unknown 設定値
 * @return string ブースト無しなら空文字列
 */
export const audioBoostFilter = (value: unknown): string => {
    const boost = normalizeAudioBoost(value);

    return boost === MIN_AUDIO_BOOST ? '' : `volume=${boost}`;
};
