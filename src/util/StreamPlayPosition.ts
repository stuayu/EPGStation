/**
 * 録画ストリームの開始位置を API / エンコーダ共通の整数秒へ正規化する。
 * @param value: unknown 再生位置 (秒)
 * @return number 0 以上の整数秒。不正値は 0
 */
export const normalizeStreamPlayPosition = (value: unknown): number => {
    const position = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(position) === false || position <= 0) return 0;

    return Math.floor(position);
};
