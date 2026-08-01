/**
 * ログ 1 行を構造 (時刻・レベル・カテゴリ・本文) に分解するユーティリティ。
 *
 * EPGStation のログは log4js の既定パターンで出力される
 *   [2026-08-02T12:00:00.000] [INFO] system - メッセージ
 * 画面ではこれを分解して時刻・レベル・カテゴリを別々に描画する
 * (パターンに合わない行 = スタックトレースの続きなどは本文だけの行として扱う)
 */

export type LogLevel = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'UNKNOWN';

export interface ParsedLogLine {
    // 行の生テキスト (コピー・検索用)
    raw: string;
    timestamp: string | null;
    level: LogLevel;
    category: string | null;
    message: string;
}

/**
 * キーワード強調のためにテキストを分割した結果
 */
export interface HighlightedPart {
    text: string;
    matched: boolean;
}

const LINE_PATTERN = /^\[([^\]]+)\]\s*\[([A-Z]+)\]\s*([^\s-]+)?\s*-\s*([\s\S]*)$/;
const LEVELS: LogLevel[] = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

/**
 * ログ 1 行を分解する
 * @param line: string
 * @return ParsedLogLine
 */
export const parseLogLine = (line: string): ParsedLogLine => {
    const matched = LINE_PATTERN.exec(line);
    if (matched === null) {
        return { raw: line, timestamp: null, level: 'UNKNOWN', category: null, message: line };
    }

    const level = matched[2].toUpperCase() as LogLevel;

    return {
        raw: line,
        timestamp: formatTimestamp(matched[1]),
        level: LEVELS.includes(level) === true ? level : 'UNKNOWN',
        category: matched[3] ?? null,
        message: matched[4],
    };
};

/**
 * ログの時刻表記を見やすく整える (日付が今日なら時刻だけにはせず、秒までを残す)
 * @param value: string log4js が出力した時刻表記
 * @return string
 */
const formatTimestamp = (value: string): string => {
    // 2026-08-02T12:00:00.000 → 08-02 12:00:00.000
    const matched = /^\d{4}-(\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(value);

    return matched === null ? value : `${matched[1]} ${matched[2]}`;
};

/**
 * 本文をキーワードで分割する (強調表示用)。
 * 大文字小文字は区別しない。キーワードが空なら分割しない
 * @param text: string
 * @param keyword: string
 * @return HighlightedPart[]
 */
export const splitByKeyword = (text: string, keyword: string): HighlightedPart[] => {
    const needle = keyword.trim();
    if (needle === '') {
        return [{ text: text, matched: false }];
    }

    const parts: HighlightedPart[] = [];
    const lower = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let index = 0;
    for (;;) {
        const found = lower.indexOf(lowerNeedle, index);
        if (found < 0) {
            break;
        }
        if (found > index) {
            parts.push({ text: text.slice(index, found), matched: false });
        }
        parts.push({ text: text.slice(found, found + needle.length), matched: true });
        index = found + needle.length;
    }
    if (index < text.length) {
        parts.push({ text: text.slice(index), matched: false });
    }

    return parts.length === 0 ? [{ text: text, matched: false }] : parts;
};

export default parseLogLine;
