/**
 * EDCB が録画時に生成する `<録画ファイル名>.program.txt` を解析する純粋関数群
 *
 * EDCB 本体・各種プラグインでフォーマットが微妙に異なるため、
 * 「ラベル: 値」形式の行を許容付きで拾いつつ、ラベルが無い場合は
 * 1 行目を番組名、2 行目をチャンネル名として扱うフォールバックを行う
 */
namespace EDCBProgramTxtParser {
    export interface ParsedProgramTxt {
        name?: string;
        description?: string;
        channelName?: string;
        startAt?: number; // UnixTime ms
        endAt?: number; // UnixTime ms
    }

    const NAME_LABELS = ['番組名', 'タイトル', 'title', 'name'];
    const CHANNEL_LABELS = ['チャンネル', 'channel', 'ch'];
    const DESCRIPTION_LABELS = ['番組内容', '概要', 'description', 'ex'];

    // yyyy/MM/dd(ddd) HH:mm ～ yyyy/MM/dd(ddd) HH:mm 形式の日時範囲
    const TIME_RANGE_PATTERN =
        /(?<syear>\d{4})[/-](?<smonth>\d{1,2})[/-](?<sday>\d{1,2}).*?(?<shour>\d{1,2}):(?<smin>\d{1,2})(?:\s*[~〜～-]\s*(?:(?<eyear>\d{4})[/-](?<emonth>\d{1,2})[/-](?<eday>\d{1,2}).*?)?(?<ehour>\d{1,2}):(?<emin>\d{1,2}))?/;

    function toDate(year: string, month: string, day: string, hour: string, min: string): number | undefined {
        const date = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
        );

        return Number.isNaN(date.getTime()) ? undefined : date.getTime();
    }

    /**
     * `<録画ファイル名>.program.txt` の内容を解析する
     * @param content: string ファイル内容
     * @return ParsedProgramTxt
     */
    export function parse(content: string): ParsedProgramTxt {
        const result: ParsedProgramTxt = {};
        const lines = content.split(/\r?\n/).map(l => l.trim());
        const descriptionLines: string[] = [];
        let isInDescription = false;

        for (const line of lines) {
            if (line.length === 0) {
                continue;
            }

            const labelMatch = line.match(/^([^:：]+)[:：]\s*(.*)$/);
            if (labelMatch !== null) {
                const label = labelMatch[1].trim().toLowerCase();
                const value = labelMatch[2].trim();

                if (NAME_LABELS.some(l => label === l.toLowerCase())) {
                    result.name = value;
                    isInDescription = false;
                    continue;
                }
                if (CHANNEL_LABELS.some(l => label === l.toLowerCase())) {
                    result.channelName = value;
                    isInDescription = false;
                    continue;
                }
                if (DESCRIPTION_LABELS.some(l => label === l.toLowerCase())) {
                    descriptionLines.push(value);
                    isInDescription = true;
                    continue;
                }
            }

            const timeMatch = line.match(TIME_RANGE_PATTERN);
            if (timeMatch !== null && typeof timeMatch.groups !== 'undefined') {
                const g = timeMatch.groups;
                result.startAt = toDate(g.syear, g.smonth, g.sday, g.shour, g.smin);
                if (typeof g.ehour !== 'undefined' && typeof g.emin !== 'undefined') {
                    const eyear = g.eyear ?? g.syear;
                    const emonth = g.emonth ?? g.smonth;
                    const eday = g.eday ?? g.sday;
                    result.endAt = toDate(eyear, emonth, eday, g.ehour, g.emin);

                    // 終了時刻が開始時刻より前 (日付をまたいだ) 場合は 1 日進める
                    if (
                        typeof result.startAt === 'number' &&
                        typeof result.endAt === 'number' &&
                        result.endAt < result.startAt
                    ) {
                        result.endAt += 24 * 60 * 60 * 1000;
                    }
                }
                isInDescription = false;
                continue;
            }

            if (isInDescription === true) {
                descriptionLines.push(line);
                continue;
            }

            // ラベルが無い場合のフォールバック: 1 行目を番組名として扱う
            if (typeof result.name === 'undefined') {
                result.name = line;
            } else if (typeof result.channelName === 'undefined') {
                result.channelName = line;
            }
        }

        if (descriptionLines.length > 0) {
            result.description = descriptionLines.join('\n');
        }

        return result;
    }
}

export default EDCBProgramTxtParser;
