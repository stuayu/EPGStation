/**
 * EDCB 等の外部録画ツールが生成するファイル名から番組情報を推定する純粋関数群
 * DI に依存しないプレーンな関数として実装し、UT で網羅的に検証できるようにしている
 */
namespace EDCBFileNameParser {
    export interface ParsedFileName {
        startAt?: number; // 開始時刻 (UnixTime ms)
        name?: string; // 番組名
        channelName?: string; // チャンネル名
    }

    // ビルトインのファイル名パターン (プリセット)。名前付きキャプチャグループ (year, month, day, hour, min, sec, name, channel) を使用する
    const PRESETS: RegExp[] = [
        // 例: 202607262100_アニメ番組_TOKYOMX.ts (EDCB でよく使われる yyyyMMddHHmm_番組名_チャンネル名 形式)
        /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<min>\d{2})(?<sec>\d{2})?[_\- ]+(?<name>.+?)[_\- ]+(?<channel>[^_\-\s]+)$/,
        // 例: アニメ番組_TOKYOMX_20260726-2100.ts
        /^(?<name>.+?)[_\- ]+(?<channel>[^_\-\s]+)[_\- ]+(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})[_\-](?<hour>\d{2})(?<min>\d{2})(?<sec>\d{2})?$/,
    ];

    /**
     * カスタム正規表現文字列 (config で定義) をコンパイルする
     * 名前付きキャプチャグループを持たない、あるいは不正な正規表現は無視する
     * @param patterns: string[]
     * @return RegExp[]
     */
    function compileCustomPatterns(patterns: string[]): RegExp[] {
        const result: RegExp[] = [];
        for (const p of patterns) {
            try {
                result.push(new RegExp(p));
            } catch (err: any) {
                // 不正な正規表現は無視する
            }
        }

        return result;
    }

    /**
     * ファイル名 (拡張子なし) から番組情報を推定する
     * カスタムパターンが指定されていればプリセットより優先して試行する
     * @param baseName: string 拡張子を除いたファイル名
     * @param customPatterns: string[] config で定義されたカスタム正規表現 (文字列)
     * @return ParsedFileName | null マッチしなければ null
     */
    export function parse(baseName: string, customPatterns: string[] = []): ParsedFileName | null {
        const patterns = [...compileCustomPatterns(customPatterns), ...PRESETS];

        for (const pattern of patterns) {
            const matched = baseName.match(pattern);
            if (matched === null || typeof matched.groups === 'undefined') {
                continue;
            }

            const g = matched.groups;
            const result: ParsedFileName = {};

            if (
                typeof g.year !== 'undefined' &&
                typeof g.month !== 'undefined' &&
                typeof g.day !== 'undefined' &&
                typeof g.hour !== 'undefined' &&
                typeof g.min !== 'undefined'
            ) {
                const year = parseInt(g.year, 10);
                const month = parseInt(g.month, 10);
                const day = parseInt(g.day, 10);
                const hour = parseInt(g.hour, 10);
                const min = parseInt(g.min, 10);
                const sec = typeof g.sec !== 'undefined' ? parseInt(g.sec, 10) : 0;

                const date = new Date(year, month - 1, day, hour, min, sec);
                if (!Number.isNaN(date.getTime())) {
                    result.startAt = date.getTime();
                }
            }

            if (typeof g.name !== 'undefined' && g.name.length > 0) {
                result.name = g.name.trim();
            }

            if (typeof g.channel !== 'undefined' && g.channel.length > 0) {
                result.channelName = g.channel.trim();
            }

            if (typeof result.startAt === 'undefined' && typeof result.name === 'undefined') {
                // 何も推定できなかった場合は次のパターンを試す
                continue;
            }

            return result;
        }

        return null;
    }
}

export default EDCBFileNameParser;
