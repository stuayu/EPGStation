/**
 * NX-Jikkyo の投稿入力検証と WebSocket payload 生成。
 * 投稿コマンドの対応表は KonomiTV `client/src/services/player/managers/LiveCommentManager.ts` の sendComment を移植。
 */

export type JikkyoPostOptions = {
    text: string;
    color: string;
    type: 'top' | 'right' | 'bottom';
    size: 'big' | 'medium' | 'small';
};

export type JikkyoPostPayload = {
    type: 'postComment';
    data: {
        text: string;
        color: string;
        position: 'ue' | 'naka' | 'shita';
        size: 'big' | 'medium' | 'small';
        vpos: number;
        isAnonymous: true;
    };
};

/** hashedUserId が有効な場合のみ NX-Jikkyo の nicolive threadkey として使う。 */
export function createJikkyoThreadKey(hashedUserId: unknown): string | null {
    return typeof hashedUserId === 'string' && hashedUserId.length > 0 ? `nicolive:${hashedUserId}` : null;
}

/** 初期履歴後の yourpost、または送信直後の同一本文エコーを判定する。 */
export function shouldDropJikkyoEcho(
    comment: { yourpost?: number; content?: string },
    initialCommentsReceived: boolean,
    pending: Array<{ text: string; sentAt: number }>,
    now: number,
): boolean {
    if (initialCommentsReceived && comment.yourpost === 1) return true;
    if (typeof comment.content !== 'string') return false;
    const index = pending.findIndex(item => item.text === comment.content && now - item.sentAt <= 5000);
    if (index < 0) return false;
    pending.splice(index, 1);
    return true;
}

const COLORS: Record<string, string> = {
    '#FFEAEA': 'white',
    '#F02840': 'red',
    '#FD7E80': 'pink',
    '#FDA708': 'orange',
    '#FFE133': 'yellow',
    '#64DD17': 'green',
    '#00D4F5': 'cyan',
    '#4763FF': 'blue',
};

const POSITIONS: Record<JikkyoPostOptions['type'], JikkyoPostPayload['data']['position']> = {
    top: 'ue',
    right: 'naka',
    bottom: 'shita',
};

/** コメント本文を検証。NX-Jikkyo の上限は 75 文字、連投間隔は 1 秒。 */
export function validateJikkyoPost(text: string, now: number, lastSentAt: number | null): string | null {
    if (text.trim().length === 0) return 'コメントを入力してください。';
    if (text.length > 75) return 'コメントは 75 文字以内で入力してください。';
    if (/[\r\n]/.test(text)) return 'コメントに改行は使用できません。';
    if (lastSentAt !== null && now - lastSentAt < 1000) return '連続してコメントを送信できません。';
    return null;
}

/** DPlayer の色・位置を NX-Jikkyo の postComment payload に変換する。 */
export function createJikkyoPostPayload(
    options: JikkyoPostOptions,
    now: number,
    vposBaseTimestamp: number,
): JikkyoPostPayload {
    const color = COLORS[options.color.toUpperCase()];
    if (color === undefined) throw new Error(`Unsupported comment color: ${options.color}`);
    return {
        type: 'postComment',
        data: {
            text: options.text,
            color,
            position: POSITIONS[options.type],
            size: options.size,
            vpos: Math.round((now - vposBaseTimestamp) / 10),
            isAnonymous: true,
        },
    };
}
