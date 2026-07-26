/**
 * EDCB が録画時に生成する `<録画ファイル名>.err` (ドロップログ) を解析する純粋関数群
 *
 * EDCB の err ファイルは概ね 1 行 1 エラーイベントの形式で出力され、
 * 「scrambling」「drop」等のキーワードでスクランブル検出とパケットドロップを区別できる。
 * 厳密なフォーマットはツール/バージョンによって差異があるため、ここでは
 * 行数ベースの概算値を返すヒューリスティックな実装とする。
 */
namespace EDCBErrParser {
    export interface ParsedErrFile {
        dropCount: number;
        scramblingCount: number;
    }

    const SCRAMBLE_KEYWORD = /scrambl|スクランブル/i;

    /**
     * `<録画ファイル名>.err` の内容を解析する
     * @param content: string ファイル内容
     * @return ParsedErrFile
     */
    export function parse(content: string): ParsedErrFile {
        const result: ParsedErrFile = { dropCount: 0, scramblingCount: 0 };

        const lines = content
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length > 0);

        for (const line of lines) {
            if (SCRAMBLE_KEYWORD.test(line)) {
                result.scramblingCount++;
            } else {
                result.dropCount++;
            }
        }

        return result;
    }
}

export default EDCBErrParser;
