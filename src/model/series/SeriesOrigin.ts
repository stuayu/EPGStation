/**
 * シリーズの出所判定。
 * 外部の作品辞書 (しょぼいカレンダー / Annict / Wikidata) の ID を 1 つでも持つものを「辞書起点」とみなす。
 * 辞書で引けずに録画タイトルだけから作られたシリーズは誤生成されやすく、マージ対象になりやすいため区別する
 */
export type SeriesOrigin = 'dictionary' | 'local';

export interface SeriesExternalIds {
    syobocalTid?: number | null;
    annictId?: string | null;
    wikidataQid?: string | null;
}

/**
 * シリーズの出所を返す
 * @param value: SeriesExternalIds 外部 ID 群
 * @return SeriesOrigin 'dictionary': 作品辞書由来 / 'local': 録画タイトルから作られた
 */
export const getSeriesOrigin = (value: SeriesExternalIds): SeriesOrigin => {
    const hasSyobocal = typeof value.syobocalTid === 'number' && value.syobocalTid !== null;
    const hasAnnict = typeof value.annictId === 'string' && value.annictId !== '';
    const hasWikidata = typeof value.wikidataQid === 'string' && value.wikidataQid !== '';
    return hasSyobocal || hasAnnict || hasWikidata ? 'dictionary' : 'local';
};
