export interface ByteRange {
    start: number;
    end: number;
}

export type ByteRangeParseResult = { kind: 'none' } | { kind: 'valid'; range: ByteRange } | { kind: 'unsatisfiable' };

/** HTTP Range ヘッダーを 1 本の byte range として検証する。 */
export const parseByteRangeHeader = (
    range: string | string[] | undefined | null,
    totalLength: number,
): ByteRangeParseResult => {
    if (typeof range !== 'string' || range.length === 0) return { kind: 'none' };
    if (!Number.isSafeInteger(totalLength) || totalLength <= 0) return { kind: 'unsatisfiable' };

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match === null || (match[1] === '' && match[2] === '')) return { kind: 'unsatisfiable' };

    const startText = match[1];
    const endText = match[2];
    if (startText === '') {
        const suffixLength = Number(endText);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'unsatisfiable' };
        return { kind: 'valid', range: { start: Math.max(0, totalLength - suffixLength), end: totalLength - 1 } };
    }

    const start = Number(startText);
    if (!Number.isSafeInteger(start) || start >= totalLength) return { kind: 'unsatisfiable' };
    const end = endText === '' ? totalLength - 1 : Number(endText);
    if (!Number.isSafeInteger(end) || end < start || end >= totalLength) return { kind: 'unsatisfiable' };

    return { kind: 'valid', range: { start, end } };
};
