import * as apid from '../../../api';

/**
 * シリーズ一覧・シリーズ詳細で共通して使う表示用の変換をまとめる。
 * (クール表記・視聴率・容量表記・シリーズの出所ラベル)
 */
namespace SeriesDisplay {
    const SEASON_LABEL: Record<string, string> = {
        WINTER: '冬',
        SPRING: '春',
        SUMMER: '夏',
        AUTUMN: '秋',
    };

    const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

    /**
     * クール名 (WINTER など) を日本語 1 文字にする
     * @param seasonName: string | null | undefined
     * @return string 未知の値はそのまま返す
     */
    export const seasonLabel = (seasonName: string | null | undefined): string => {
        if (typeof seasonName !== 'string' || seasonName === '') return '';

        return SEASON_LABEL[seasonName] ?? seasonName;
    };

    /**
     * 画面に出すクール表記 ("2025年春")
     * @param item: クール情報を持つシリーズ
     * @return string 年が無い場合は '-'
     */
    export const seasonText = (item: { seasonYear?: number | null; seasonName?: string | null }): string => {
        if (typeof item.seasonYear !== 'number' || item.seasonYear === null) return '-';

        return `${item.seasonYear}年${seasonLabel(item.seasonName)}`;
    };

    /**
     * 視聴済みの割合 (進捗バー用)
     * @param item: 録画件数と未視聴件数を持つシリーズ
     * @return number 0〜100
     */
    export const watchedPercent = (item: { recordedCount: number; unwatchedCount: number }): number => {
        if (item.recordedCount === 0) return 0;

        return Math.round(((item.recordedCount - item.unwatchedCount) / item.recordedCount) * 100);
    };

    /**
     * バイト数を人が読める表記にする
     * @param size: number
     * @return string
     */
    export const fileSizeText = (size: number): string => {
        if (!size || size <= 0) return '0 B';
        const index = Math.min(FILE_SIZE_UNITS.length - 1, Math.floor(Math.log(size) / Math.log(1024)));

        return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${FILE_SIZE_UNITS[index]}`;
    };

    /**
     * シリーズの出所 (辞書起点 / 録画タイトル起点) のラベル
     */
    export const originText = (item: { origin?: apid.SeriesOrigin }): string => {
        return item.origin === 'dictionary' ? '辞書' : 'ローカル';
    };

    export const originColor = (item: { origin?: apid.SeriesOrigin }): string => {
        return item.origin === 'dictionary' ? 'teal' : 'grey';
    };

    export const originTitle = (item: { origin?: apid.SeriesOrigin }): string => {
        return item.origin === 'dictionary'
            ? 'しょぼいカレンダー / Annict / Wikidata の作品辞書に紐づくシリーズ'
            : '録画タイトルから作られたシリーズ (誤生成の可能性あり)';
    };
}

export default SeriesDisplay;
