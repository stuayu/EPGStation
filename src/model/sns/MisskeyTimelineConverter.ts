import * as apid from '../../../api';
import { MisskeyNote } from './IMisskeyClient';

namespace MisskeyTimelineConverter {
    // リアクション文字列からカスタム絵文字名 (+ リモートの場合はホスト名) を取り出す。
    // ローカルは ':name:' / ':name@.:'、リモートは ':name@host:' の形式がある
    export const REACTION_KEY_PATTERN = /^:([^:@]+)(?:@([^:]+))?:$/;
}

/**
 * Misskey のノートを共通形 (`SnsTimelineNote`) へ変換する。
 * **割り切り**: 本文もファイルも持たない「純粋なリノート」は、参照先 (`renote`) の
 * 本文・添付・CW を借りて表示する (リノート先がさらにリノートの場合はそれ以上遡らない)。
 * `isRenotedByMe` は Misskey のタイムライン応答に直接の対応フィールドが無いため、常に false を返す
 * (自分のリノート有無を知るには別途 API を叩く必要があり、TL 描画のたびにそれを行うのは高コストなため見送る)
 *
 * **リアクション絵文字の解決順序** (この順に上から試し、最初に見つかったものを使う):
 * 1. `note.reactionEmojis['name@host']` (リモート絵文字。ホストが `.` (ローカルを指す慣習表記) のときは対象外)
 * 2. `note.reactionEmojis['name']` (ローカル絵文字、あるいはリモートでも host なしキーで入っていた場合)
 * 3. `resolveEmojiUrl(name)` — 呼び出し側が渡すインスタンス単位の絵文字キャッシュ
 *    (`MisskeyClient.getEmojis()`)。**WebSocket ストリーミング経由の note には `reactionEmojis` 自体が
 *    入っていないことがある**ため、その場合はここでしか解決できない
 * どれでも見つからなければ `url: null` のまま返し、クライアントは `:name:` の短縮名を出す
 * (それでも Unicode 絵文字リアクション (`👍` 等、そもそも `:name:` 形式にマッチしない) はこの解決の対象外で、
 * これまでどおり文字そのままが `name` に入って返る — クライアントはそれをそのまま表示すればよい)
 * @param host: string ノートを開く URL の組み立てに使うインスタンスのホスト名
 * @param note: MisskeyNote
 * @param resolveEmojiUrl?: (name: string) => string | null インスタンス単位の絵文字キャッシュから名前で引く関数
 * @return apid.SnsTimelineNote
 */
export const convertMisskeyNoteToTimelineNote = (
    host: string,
    note: MisskeyNote,
    resolveEmojiUrl: (name: string) => string | null = () => null,
): apid.SnsTimelineNote => {
    const isPureRenote =
        note.text === null && note.files.length === 0 && typeof note.renote !== 'undefined' && note.renote !== null;
    const body = isPureRenote ? (note.renote as MisskeyNote) : note;

    const reactions: apid.SnsTimelineNote['reactions'] = [];
    for (const [key, count] of Object.entries(note.reactions)) {
        const match = MisskeyTimelineConverter.REACTION_KEY_PATTERN.exec(key);
        let url: string | null = null;
        if (match !== null) {
            const name = match[1];
            const emojiHost = match[2];
            const remoteUrl =
                typeof emojiHost === 'string' && emojiHost !== '.'
                    ? (note.reactionEmojis[`${name}@${emojiHost}`] ?? null)
                    : null;
            url = remoteUrl ?? note.reactionEmojis[name] ?? resolveEmojiUrl(name);
        }
        reactions.push({
            name: key,
            count,
            url,
            isMine: note.myReaction === key,
        });
    }

    return {
        id: note.id,
        createdAt: Date.parse(note.createdAt),
        text: body.text ?? '',
        cw: body.cw,
        author: {
            id: body.user.id,
            handle:
                body.user.host !== null && body.user.host !== ''
                    ? `${body.user.username}@${body.user.host}`
                    : body.user.username,
            displayName: body.user.name ?? body.user.username,
            avatarUrl: body.user.avatarUrl,
        },
        images: body.files.map(file => ({
            url: file.url ?? '',
            thumbnailUrl: file.thumbnailUrl,
            isSensitive: file.isSensitive,
        })),
        reactions,
        renoteCount: note.renoteCount,
        isRenotedByMe: false,
        url: note.id !== '' ? `https://${host}/notes/${note.id}` : null,
    };
};
