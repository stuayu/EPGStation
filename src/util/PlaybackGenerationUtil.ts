/** 非同期再生処理が現在のプレイヤー世代へ属するか判定する。 */
export const isPlaybackGenerationCurrent = (expected: number, current: number): boolean =>
    Number.isSafeInteger(expected) && Number.isSafeInteger(current) && expected === current;
