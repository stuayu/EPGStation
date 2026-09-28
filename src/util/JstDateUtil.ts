const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の日付境界を UTC タイムスタンプで返す */
export const getJstMidnight = (timestamp: number): number => {
    const jstDate = new Date(timestamp + JST_OFFSET_MS);
    return Date.UTC(jstDate.getUTCFullYear(), jstDate.getUTCMonth(), jstDate.getUTCDate()) - JST_OFFSET_MS;
};

/** タイムスタンプの JST 曜日を返す */
export const getJstDay = (timestamp: number): number => new Date(timestamp + JST_OFFSET_MS).getUTCDay();
