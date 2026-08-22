namespace DateUtil {
    const fmt: Record<string, (date: Date) => string> = {
        yyyy: (date: Date): string => {
            return date.getFullYear() + '';
        },
        YY: (date: Date): string => {
            return `${date.getFullYear()}`.slice(2, 4);
        },
        MM: (date: Date): string => {
            return ('0' + (date.getMonth() + 1)).slice(-2);
        },
        dd: (date: Date): string => {
            return ('0' + date.getDate()).slice(-2);
        },
        hh: (date: Date): string => {
            return ('0' + date.getHours()).slice(-2);
        },
        mm: (date: Date): string => {
            return ('0' + date.getMinutes()).slice(-2);
        },
        ss: (date: Date): string => {
            return ('0' + date.getSeconds()).slice(-2);
        },
        SSS: (date: Date): string => {
            return ('000' + date.getMilliseconds()).slice(-3);
        },
        w: (date: Date): string => {
            return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
        },
    };

    /**
     * Date を string に変換
     * @param date: Date
     * @param formatStr: string yyyy MM dd hh mm ss w
     * @return string
     */
    export const format = (date: Date, formatStr: string): string => {
        for (const key in fmt) {
            formatStr = formatStr.replace(key, fmt[key](date));
        }

        return formatStr;
    };

    /**
     * 日本時間を返す
     * @param localDate Date
     * @return Date
     */
    export const getJaDate = (localDate: Date): Date => {
        const offSet = localDate.getTimezoneOffset() * 60 * 1000 + 1000 * 60 * 60 * 9;

        return new Date(localDate.getTime() + offSet);
    };

    /**
     * 相対時刻の文字列を返す (SNS タイムライン等の投稿時刻表示用)
     * 1 分未満は「たった今」、1 時間未満は「n分前」、24 時間未満は「n時間前」、
     * 7 日未満は「n日前」、それ以降は yyyy/MM/dd を返す
     * @param unixTimeMs: number
     * @return string
     */
    export const getRelativeTimeString = (unixTimeMs: number): string => {
        const diffMs = Date.now() - unixTimeMs;
        if (diffMs < 0) {
            return format(new Date(unixTimeMs), 'yyyy/MM/dd hh:mm');
        }

        const diffMinutes = Math.floor(diffMs / (60 * 1000));
        if (diffMinutes < 1) {
            return 'たった今';
        }
        if (diffMinutes < 60) {
            return `${diffMinutes}分前`;
        }

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return `${diffHours}時間前`;
        }

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) {
            return `${diffDays}日前`;
        }

        return format(new Date(unixTimeMs), 'yyyy/MM/dd');
    };
}

export default DateUtil;
