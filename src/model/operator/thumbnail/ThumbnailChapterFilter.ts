import * as apid from '../../../../api';
import { ThumbnailCandidate } from './ThumbnailCandidateGenerator';

const CHAPTER_MARGIN_SECONDS = 0.5;

export interface ThumbnailChapterFilterResult {
    candidates: ThumbnailCandidate[];
    usedFallback: boolean;
}

/** チャプター名が trim 後、大文字小文字を問わず CM で始まるか判定する。 */
export function isCommercialChapter(chapter: apid.VideoChapter): boolean {
    return (chapter.title ?? '').trim().toUpperCase().startsWith('CM');
}

/** CM チャプター境界の前後0.5秒を含め、候補時刻が除外対象か判定する。 */
export function isInCommercialChapter(timestamp: number, chapters: apid.VideoChapter[]): boolean {
    return chapters.some(chapter =>
        isCommercialChapter(chapter) &&
        Number.isFinite(chapter.startAt) &&
        Number.isFinite(chapter.endAt) &&
        chapter.endAt > chapter.startAt &&
        timestamp >= chapter.startAt - CHAPTER_MARGIN_SECONDS &&
        timestamp < chapter.endAt + CHAPTER_MARGIN_SECONDS,
    );
}

/**
 * CM候補を除外し、全候補が消えた場合は非CMチャプター中央で補完する。
 * 補完不能なら画像未生成を避けるため元候補へ戻す。
 */
export function filterThumbnailCandidatesByChapters(
    candidates: ThumbnailCandidate[],
    chapters: apid.VideoChapter[],
    searchDuration: number,
    count: number,
): ThumbnailChapterFilterResult {
    const maxCount = Math.max(1, Math.floor(count));
    const normalize = (items: ThumbnailCandidate[]): ThumbnailCandidate[] => items
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, maxCount)
        .map((candidate, index) => ({ timestamp: candidate.timestamp, index }));
    const validChapters = chapters.filter(chapter =>
        Number.isFinite(chapter.startAt) &&
        Number.isFinite(chapter.endAt) &&
        chapter.endAt > chapter.startAt,
    );
    if (chapters.length > 0 && validChapters.length === 0) {
        return { candidates: normalize(candidates), usedFallback: true };
    }
    const filtered = candidates.filter(candidate => !isInCommercialChapter(candidate.timestamp, validChapters));
    if (filtered.length > 0) {
        return { candidates: normalize(filtered), usedFallback: false };
    }

    const chapterCenters = validChapters
        .filter(chapter => !isCommercialChapter(chapter))
        .map(chapter => (chapter.startAt + chapter.endAt) / 2)
        .filter(timestamp => timestamp >= 0 && timestamp < searchDuration)
        .map((timestamp, index) => ({ timestamp, index }));
    if (chapterCenters.length > 0) {
        return { candidates: normalize(chapterCenters), usedFallback: false };
    }
    return { candidates: normalize(candidates), usedFallback: chapters.length > 0 };
}
