/**
 * 予約の推定サイズを画面表示用に整形する
 * @param size byte 単位のサイズ
 * @return 推定サイズの表示文字列
 */
export default class EstimatedSizeUtil {
    public static format(size: number | undefined): string | null {
        if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;

        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let value = size;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }

        return `約 ${value.toFixed(1)} ${units[unitIndex]} (推定)`;
    }
}
