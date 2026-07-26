import { SeriesRecordedRow } from '../db/ISeriesDB';
export interface SeriesContinuity {
    missingEpisodes: Array<{ seasonNumber: number; episodeNumber: number }>;
    duplicateEpisodes: Array<{
        seasonNumber: number;
        episodeNumber: number;
        recordedIds: number[];
        channelIds: number[];
    }>;
    unknownEpisodeRecordedIds: number[];
}
export interface ContinuityOptions {
    // 外部メタデータ (しょぼいカレンダー / Annict) から得た放送予定総話数 (シーズン番号 → 総話数)。
    // 指定があるシーズンは観測済み最大話数ではなくこの総話数まで欠番検出の対象にする (§4.7)
    totalEpisodesBySeason?: Record<number, number>;
    // 放送ペース補正の基準時刻 (省略時 Date.now())。テスト容易性のために注入可能にしている
    now?: number;
}
/**
 * 隣接話数間の放送間隔 (ペース) を局ごとに求め、最も観測数が多い局 (基準局) のペースから
 * 「現時点までに放送されているはずの最大話数」を推定する (§5.4)。
 * 未登録局でのみ視聴している作品は放送実績が疎らになりがちなため、この基準局ペースで
 * 補正することで「まだ放送されていない話」を欠番と誤検出することを防ぐ
 */
function estimatePaceBasedMaxEpisode(rows: SeriesRecordedRow[], now: number): number | null {
    const byChannel = new Map<number, Array<{ episodeNumber: number; startAt: number }>>();
    for (const row of rows) {
        if (row.episodeNumber === null) continue;
        const ep = Number(row.episodeNumber);
        if (!Number.isInteger(ep) || ep < 1) continue;
        const list = byChannel.get(row.channelId) ?? [];
        list.push({ episodeNumber: ep, startAt: Number(row.startAt) });
        byChannel.set(row.channelId, list);
    }
    // 最も件数が多い局を基準局とする (放送実績が最も安定して観測できているとみなす)
    let reference: Array<{ episodeNumber: number; startAt: number }> | null = null;
    for (const list of byChannel.values()) {
        if (list.length < 2) continue;
        if (!reference || list.length > reference.length) reference = list;
    }
    if (!reference) return null;
    reference.sort((a, b) => a.episodeNumber - b.episodeNumber);
    let totalIntervalMs = 0;
    let totalEpisodeGap = 0;
    for (let i = 1; i < reference.length; i++) {
        const gap = reference[i].episodeNumber - reference[i - 1].episodeNumber;
        const interval = reference[i].startAt - reference[i - 1].startAt;
        if (gap > 0 && interval > 0) {
            totalIntervalMs += interval;
            totalEpisodeGap += gap;
        }
    }
    if (totalEpisodeGap === 0) return null;
    const paceMs = totalIntervalMs / totalEpisodeGap;
    if (!Number.isFinite(paceMs) || paceMs <= 0) return null;
    const first = reference[0];
    const elapsedSinceFirst = now - first.startAt;
    if (elapsedSinceFirst < 0) return first.episodeNumber;
    return first.episodeNumber + Math.floor(elapsedSinceFirst / paceMs);
}
export function analyzeSeriesContinuity(rows: SeriesRecordedRow[], options: ContinuityOptions = {}): SeriesContinuity {
    const groups = new Map<string, SeriesRecordedRow[]>(),
        seasons = new Map<number, Set<number>>();
    const rowsBySeason = new Map<number, SeriesRecordedRow[]>();
    const unknown: number[] = [];
    for (const row of rows) {
        const season = Number(row.seasonNumber ?? 1),
            ep = row.episodeNumber === null ? null : Number(row.episodeNumber);
        if (ep === null || !Number.isFinite(ep)) {
            unknown.push(Number(row.recordedId));
            continue;
        }
        const key = `${season}:${ep}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
        rowsBySeason.set(season, [...(rowsBySeason.get(season) ?? []), row]);
        if (Number.isInteger(ep) && ep >= 1) {
            const set = seasons.get(season) ?? new Set<number>();
            set.add(ep);
            seasons.set(season, set);
        }
    }
    const now = options.now ?? Date.now();
    const missing = [] as Array<{ seasonNumber: number; episodeNumber: number }>;
    for (const [season, set] of seasons) {
        const observedMax = Math.max(...set);
        // 優先度: 外部メタデータの放送予定総話数 > 放送ペース補正による推定 > 観測済み最大話数
        const total = options.totalEpisodesBySeason?.[season];
        const paceMax = estimatePaceBasedMaxEpisode(rowsBySeason.get(season) ?? [], now);
        const max = typeof total === 'number' && total > 0 ? total : Math.max(observedMax, paceMax ?? 0);
        for (let n = 1; n <= max; n++) if (!set.has(n)) missing.push({ seasonNumber: season, episodeNumber: n });
    }
    const duplicateEpisodes = [] as SeriesContinuity['duplicateEpisodes'];
    for (const [key, items] of groups) {
        if (items.length < 2) continue;
        const [seasonNumber, episodeNumber] = key.split(':').map(Number);
        duplicateEpisodes.push({
            seasonNumber,
            episodeNumber,
            recordedIds: items.map(x => Number(x.recordedId)),
            channelIds: [...new Set(items.map(x => Number(x.channelId)))],
        });
    }
    const sort = (
        a: { seasonNumber: number; episodeNumber: number },
        b: { seasonNumber: number; episodeNumber: number },
    ) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber;
    return {
        missingEpisodes: missing.sort(sort),
        duplicateEpisodes: duplicateEpisodes.sort(sort),
        unknownEpisodeRecordedIds: unknown,
    };
}
