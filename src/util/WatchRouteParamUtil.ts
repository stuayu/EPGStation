/**
 * 視聴画面の URL query / path に含まれる整数を厳密に解釈する。
 * parseInt() は `12abc` を 12 と解釈するため、視聴対象を誤って生成しないように使わない。
 * @param value: unknown URL の値
 * @param minimum: number 許可する最小値
 * @return number | null 不正な値は null
 */
export const parseWatchRouteInteger = (value: unknown, minimum: number): number | null => {
    if (typeof value !== 'string' || /^(?:0|[1-9][0-9]*)$/u.test(value) === false) {
        return null;
    }

    const result = Number(value);
    if (Number.isSafeInteger(result) === false || result < minimum) {
        return null;
    }

    return result;
};

/**
 * 視聴画面の mode が config の設定範囲に入っているか確認する。
 * 設定一覧が空の場合は旧形式の config で範囲を確定できないため、非負整数の検証だけ通す。
 * @param mode: number
 * @param modeNames: readonly string[] config の設定名一覧
 * @return boolean
 */
export const isWatchModeInRange = (mode: number, modeNames: readonly string[]): boolean => {
    return Number.isSafeInteger(mode) && mode >= 0 && (modeNames.length === 0 || mode < modeNames.length);
};

