import * as apid from '../../../api';

/**
 * 視聴状態 (WatchStatus) の表示用ラベル・色を解決する共通ユーティリティ
 * 録画カード・Next Up パネルなど、視聴状態バッジを表示する箇所で再利用すること
 */
export default class WatchStatusUtil {
    /**
     * 表示ラベルを返す
     * @param status: apid.WatchStatus | undefined
     * @return string | null 対象外 (未取得) の場合は null
     */
    public static getLabel(status: apid.WatchStatus | undefined): string | null {
        if (status === 'watched') return '視聴済み';
        if (status === 'watching') return '視聴中';
        if (status === 'unwatched') return '未視聴';

        return null;
    }

    /**
     * v-chip 用の色を返す
     * @param status: apid.WatchStatus | undefined
     * @return string
     */
    public static getColor(status: apid.WatchStatus | undefined): string {
        if (status === 'watched') return 'success';
        if (status === 'watching') return 'primary';

        return 'default';
    }
}
