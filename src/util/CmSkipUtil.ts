import type * as apid from '../../api';
import { isCommercialChapter } from './CommercialChapterUtil';

export interface CmSkipState {
    previousTime: number | null;
    skippedBlocks: number[];
}

export interface CmBlock {
    startAt: number;
    endAt: number;
}

/** 隣接する CM チャプターを連続ブロックへまとめる。 */
export function getCmBlocks(chapters: apid.VideoChapter[]): CmBlock[] {
    const items = chapters
        .filter(
            c =>
                isCommercialChapter(c) && Number.isFinite(c.startAt) && Number.isFinite(c.endAt) && c.endAt > c.startAt,
        )
        .map(c => ({ startAt: c.startAt, endAt: c.endAt }))
        .sort((a, b) => a.startAt - b.startAt);
    const result: CmBlock[] = [];
    for (const item of items) {
        const previous = result[result.length - 1];
        if (previous !== undefined && item.startAt <= previous.endAt + 0.01)
            previous.endAt = Math.max(previous.endAt, item.endAt);
        else result.push({ ...item });
    }
    return result;
}

/** 通常再生で CM ブロック開始を跨いだ場合だけ終端を返す。シーク判定は呼出側が抑止する。 */
export function findCmSkipTarget(
    previousTime: number,
    currentTime: number,
    blocks: CmBlock[],
    duration: number,
    skippedBlocks: number[] = [],
): number | null {
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return null;
    const index = blocks.findIndex(
        (block, i) =>
            !skippedBlocks.includes(i) &&
            previousTime < block.startAt &&
            currentTime >= block.startAt &&
            block.endAt < duration - 0.25,
    );
    return index < 0 ? null : blocks[index].endAt;
}

export function createCmSkipState(): CmSkipState {
    return { previousTime: null, skippedBlocks: [] };
}
