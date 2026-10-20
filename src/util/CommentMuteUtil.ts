/**
 * NX-Jikkyo コメントの共通ミュート判定。
 * KonomiTV `client/src/utils/CommentUtils.ts` の `normalizeCommentKeyword()` と
 * `isMutedComment()` を移植し、ブラウザとサーバの両方で安全な純粋関数にした。
 */
export type CommentKeywordMatch = 'partial' | 'forward' | 'backward' | 'exact' | 'regex';

export interface CommentMuteKeyword {
    match: CommentKeywordMatch;
    pattern: string;
}

export interface CommentMuteSettings {
    mutedUserIds?: string[];
    mutedKeywords?: CommentMuteKeyword[];
    normalizeKeywords?: boolean;
    muteVulgar?: boolean;
    muteAbusive?: boolean;
    muteBigSize?: boolean;
    muteFixed?: boolean;
    muteColored?: boolean;
    muteConsecutiveCharacters?: boolean;
    muteEmojiOnly?: boolean;
}

/** 設定画面で開いた後に別経路から更新された値を保ち、画面上で変えた項目だけ適用する。 */
export function mergeCommentMuteSettings(
    baseline: CommentMuteSettings,
    edited: CommentMuteSettings,
    latest: CommentMuteSettings,
): CommentMuteSettings {
    const merged = { ...latest };
    const keys = new Set([...Object.keys(baseline), ...Object.keys(edited)]) as Set<keyof CommentMuteSettings>;
    for (const key of keys) {
        if (JSON.stringify(baseline[key]) !== JSON.stringify(edited[key])) (merged as any)[key] = edited[key];
    }
    return merged;
}

export interface CommentMuteMetadata {
    userId?: string;
    color?: string;
    position?: 'top' | 'right' | 'bottom' | 'naka' | 'ue' | 'shita';
    size?: 'big' | 'medium' | 'small';
}

export interface CompiledCommentMuteSettings {
    settings: CommentMuteSettings;
    keywords: Array<{ match: CommentKeywordMatch; pattern: string; regex?: RegExp }>;
}

/** 設定更新時だけキーワード正規化・正規表現コンパイルを行う。 */
export function compileCommentMuteSettings(settings: CommentMuteSettings = {}): CompiledCommentMuteSettings {
    return {
        settings,
        keywords: (settings.mutedKeywords ?? [])
            .filter(item => item.pattern.length > 0)
            .map(item => {
                const pattern =
                    settings.normalizeKeywords && item.match !== 'regex'
                        ? normalizeCommentKeyword(item.pattern)
                        : item.pattern;
                let regex: RegExp | undefined;
                if (item.match === 'regex') {
                    try {
                        regex = new RegExp(pattern);
                    } catch {
                        /* 不正な正規表現は無視 */
                    }
                }
                return { match: item.match, pattern, regex };
            }),
    };
}

export function shouldMuteCompiledComment(
    comment: string,
    compiled: CompiledCommentMuteSettings,
    metadata: CommentMuteMetadata = {},
): boolean {
    const { settings } = compiled;
    const { userId, color, position, size } = metadata;
    if (userId && settings.mutedUserIds?.includes(userId)) return true;
    const candidate = settings.normalizeKeywords ? normalizeCommentKeyword(comment) : comment;
    for (const item of compiled.keywords) {
        if (item.match === 'partial' && candidate.includes(item.pattern)) return true;
        if (item.match === 'forward' && candidate.startsWith(item.pattern)) return true;
        if (item.match === 'backward' && candidate.endsWith(item.pattern)) return true;
        if (item.match === 'exact' && candidate === item.pattern) return true;
        if (item.match === 'regex' && item.regex?.test(comment)) return true;
    }
    return isMutedComment(comment, { ...settings, mutedKeywords: [] }, { userId, color, position, size });
}

import { VULGAR_PATTERN, ABUSIVE_PATTERN } from './CommentMuteDictionary';
const VULGAR_REGEX = new RegExp(VULGAR_PATTERN);
const ABUSIVE_REGEX = new RegExp(ABUSIVE_PATTERN);
const SPECIAL_COMMAND_PATTERN = /^\/[a-z][a-z0-9_-]*(?:\s|$)/;
const STATISTICAL_PATTERN = /最高\d+米\/|計\d+ＩＤ|総\d+米/;

/** KonomiTV と同じ NFKC・空白・ハイフン類・英字大小文字の正規化。 */
export function normalizeCommentKeyword(text: string): string {
    return text
        .normalize('NFKC')
        .replace(/[\u02D7\u2010-\u2015\u2212\u301C\u3030\u30FC\uFE31\uFE32\uFE58\uFE63\uFF0D\uFF5E]/g, '-')
        .replace(/\u3000/g, ' ')
        .toLowerCase();
}

/**
 * コメントをミュートするか判定する。入力は NX-Jikkyo / 過去ログ双方のコメント形式に対応。
 * KonomiTV `client/src/utils/CommentUtils.ts` の判定条件を移植。
 */
export function isMutedComment(
    comment: string,
    settings: CommentMuteSettings = {},
    metadata: CommentMuteMetadata = {},
): boolean {
    const { userId, color, position, size } = metadata;
    if (userId && settings.mutedUserIds?.includes(userId)) return true;
    if (SPECIAL_COMMAND_PATTERN.test(comment) || STATISTICAL_PATTERN.test(comment)) return true;
    if (settings.muteFixed && ['top', 'bottom', 'ue', 'shita'].includes(position ?? '')) return true;
    // 色が省略されたコメントを色付き扱いしない (KonomiTV 8d6853f8)。
    if (
        settings.muteColored &&
        color !== undefined &&
        !['#FFFFFF', '#FFEAEA', 'WHITE'].includes(color.trim().toUpperCase())
    )
        return true;
    if (settings.muteBigSize && size === 'big') return true;
    if (settings.muteVulgar && VULGAR_REGEX.test(comment)) return true;
    if (settings.muteAbusive && ABUSIVE_REGEX.test(comment)) return true;
    if (settings.muteConsecutiveCharacters && /(.)\1{7,}/u.test(comment)) return true;
    if (
        settings.muteEmojiOnly &&
        comment.length > 0 &&
        /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+$/u.test(comment)
    )
        return true;

    const candidate = settings.normalizeKeywords ? normalizeCommentKeyword(comment) : comment;
    for (const keyword of settings.mutedKeywords ?? []) {
        if (!keyword.pattern) continue;
        const pattern =
            settings.normalizeKeywords && keyword.match !== 'regex'
                ? normalizeCommentKeyword(keyword.pattern)
                : keyword.pattern;
        switch (keyword.match) {
            case 'partial':
                if (candidate.includes(pattern)) return true;
                break;
            case 'forward':
                if (candidate.startsWith(pattern)) return true;
                break;
            case 'backward':
                if (candidate.endsWith(pattern)) return true;
                break;
            case 'exact':
                if (candidate === pattern) return true;
                break;
            case 'regex':
                try {
                    if (new RegExp(pattern).test(comment)) return true;
                } catch {
                    /* 不正な正規表現は無視 */
                }
                break;
        }
    }
    return false;
}
