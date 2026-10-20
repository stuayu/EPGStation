const WHITE_COMMENT_COLORS = new Set(['#fff', '#ffffff', '#ffeaea', 'white', 'rgb(255, 255, 255)']);

/** 白系として扱う実況コメント色か判定する。 */
export function isWhiteCommentColor(color: string): boolean {
    return WHITE_COMMENT_COLORS.has(color.trim().toLowerCase());
}
