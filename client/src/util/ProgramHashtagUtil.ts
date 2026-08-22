import ChannelHashtagData from './ChannelHashtagData';

/**
 * 番組情報から SNS 投稿用のハッシュタグを組み立てる純粋関数群
 *
 * `getChannelHashtag()` は KonomiTV `client/src/utils/ChannelUtils.ts` の `getChannelHashtag()` を、
 * `applyHashtags()` / `normalizeHashtagInput()` は KonomiTV
 * `client/src/components/Watch/Panel/Twitter.vue` の `formatHashtag()` (1072-1099 行目) /
 * ハッシュタグ合成処理 (1133-1153 行目) を移植したもの。
 * `extractProgramHashtags()` は KonomiTV に存在しない本フォーク独自の機能
 */
namespace ProgramHashtagUtil {
    /** ハッシュタグを本文へ差し込む位置 */
    export type HashtagPosition = 'prepend' | 'append' | 'prependWithLineBreak' | 'appendWithLineBreak';

    /** `composeHashtags()` の挙動オプション */
    export interface ComposeHashtagsOptions {
        /** 局タグを合成対象に含めるか (既定 true) */
        includeChannelHashtag?: boolean;
        /** 番組概要・詳細から抽出したタグを合成対象に含めるか (既定 true) */
        includeProgramHashtags?: boolean;
    }

    // 番組概要・詳細からハッシュタグを拾う際に採用する文字種
    // (半角/全角英数字・アンダースコア・ひらがな・カタカナ (音引き含む)・漢字 (々・〆・〤 含む))
    // 実データ (番組詳細) には「#ステップＴＵＦ」のように全角英数字が混在するタグが普通に出てくるため、
    // KonomiTV には無いこの関数では全角英数字 (Ａ-Ｚ ａ-ｚ ０-９) も許容文字に含めている
    // (含めないと "#ステップＴＵＦ" が "#ステップ" で途切れてしまう)
    const PROGRAM_HASHTAG_PATTERN = /[#＃]([0-9A-Za-z_ぁ-んァ-ヶー一-龠々〆〤０-９Ａ-Ｚａ-ｚ＿]+)/g;

    // extractProgramHashtags() で拾うタグの最大数
    const MAX_PROGRAM_HASHTAGS = 3;

    /**
     * 全角ハッシュ記号を半角へ正規化する
     * @param tag ハッシュタグ (1 個分)
     * @return string 先頭が半角 `#` になったハッシュタグ
     */
    const toHalfWidthHashtag = (tag: string): string => {
        return tag.startsWith('#') ? tag : `#${tag.replace(/^[＃♯]+/, '')}`;
    };

    /**
     * 全角の英数字・アンダースコアを半角へ変換する
     *
     * 番組詳細には「#ステップＴＵＦ」のように全角英数字を含むタグが普通に入っているが、
     * SNS 側で実際に使われているのは半角表記 (`#ステップTUF`) であり、全角のまま投稿すると
     * 別のハッシュタグとして扱われて実況の輪に入れない。そのため**自動で追記するタグは半角表記を標準とする**。
     * カタカナ・ひらがな・漢字は意味が変わるため変換しない (半角カナへは絶対に倒さない)
     * @param value 変換対象の文字列
     * @return string 英数字・アンダースコアを半角へ揃えた文字列
     */
    const toHalfWidthAlnum = (value: string): string => {
        return value
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
            .replaceAll('＿', '_');
    };

    /**
     * チャンネル名から対応する局タグを取得する
     *
     * `ChannelHashtagData.SORTED_TABLE` (前方一致キーを文字数降順に並べた表) を先頭から順に見て、
     * 最初に前方一致したキーのハッシュタグを返す。これにより「テレビ朝日」と「テレビ愛知」のような
     * 前方一致キーの取り違えを防ぐ (より長いキーが先に評価される)。
     * NW1〜NW40 (県外地上波) は通常の地方局名がそのまま入ってくるため、channelType を見ずに解決できる。
     * 放送波由来の局名には「ＢＳ日テレ」のように全角英数字が混じることがあるため、
     * 表 (半角表記) と突き合わせる前にチャンネル名側の英数字を半角へ揃える
     * @param channelName チャンネル名
     * @return string | null 局タグ (一致するものがない、または明示的に対応付けが無い場合は null)
     */
    export const getChannelHashtag = (channelName: string): string | null => {
        const normalized = toHalfWidthAlnum(channelName);
        const entry = ChannelHashtagData.SORTED_TABLE.find(([key]) => normalized.startsWith(key));

        return typeof entry === 'undefined' ? null : entry[1];
    };

    /**
     * 番組概要・番組詳細から `#` / `＃` 始まりのハッシュタグを抽出する
     *
     * 以下は除外する
     * - 1 文字だけのもの (`#` 単体に近く話題性が薄い)
     * - 数字のみのもの (`#1` `#2` は話数表記であり SNS 上のハッシュタグではない)
     * - 区切りなしで数字から始まる 4 桁以下 + 後続文字があるもの
     *   (`#16星の渡り鳥` `＃19宣戦布告` のような「話数 + サブタイトル」表記。実際の番組詳細で頻出するため
     *   数字のみの除外だけでは拾いきれず、実データで確認した上でこの条件を追加している)
     * - URL の一部と思われるもの (直前の文字が `/` または `=`)
     * - `####` のような区切り線 (`#` 自体を許容文字に含めていないため、区切り線は元々マッチしない)
     *
     * 拾ったタグは**全角英数字を半角へ揃えてから返す** (`#ステップＴＵＦ` → `#ステップTUF`)。
     * SNS 側で実際に使われているのは半角表記であり、全角のまま投稿すると別のハッシュタグになってしまうため。
     * 大文字小文字を区別せず重複を除いた上で、出現順を保ったまま最大 3 個まで返す
     * @param description 番組概要
     * @param extended 番組詳細
     * @return string[] `#` 始まりのハッシュタグ一覧 (最大 3 個、英数字は半角)
     */
    export const extractProgramHashtags = (description?: string, extended?: string): string[] => {
        const result: string[] = [];
        const seen = new Set<string>();

        const collect = (text?: string): void => {
            if (typeof text !== 'string' || text.length === 0) {
                return;
            }

            // 呼び出しをまたいで lastIndex が残らないよう毎回リセットする
            PROGRAM_HASHTAG_PATTERN.lastIndex = 0;

            let match: RegExpExecArray | null;
            while ((match = PROGRAM_HASHTAG_PATTERN.exec(text)) !== null) {
                if (result.length >= MAX_PROGRAM_HASHTAGS) {
                    break;
                }

                // 自動追記するタグは半角表記を標準とする (全角英数字のままだと SNS 側で別タグになるため)
                const tag = toHalfWidthAlnum(match[1]);

                // 1 文字だけのものは除外
                if (tag.length <= 1) {
                    continue;
                }
                // 数字のみのもの (話数表記) は除外 (全角数字のみの場合も含む)
                if (/^[0-9０-９]+$/.test(tag)) {
                    continue;
                }
                // 「#16星の渡り鳥」「＃19宣戦布告」のように、区切りなしで数字から始まる語も話数 + サブタイトルの
                // 表記であって SNS のハッシュタグではないため除外する (実データで頻出することを確認済み)
                const digitPrefix = tag.match(/^[0-9０-９]+/)?.[0] ?? '';
                if (digitPrefix.length > 0 && digitPrefix.length <= 4 && digitPrefix.length < tag.length) {
                    continue;
                }
                // URL の一部 (パスの一部や `key=value#hash` の hash 部分) は除外
                const prevChar = match.index > 0 ? text[match.index - 1] : '';
                if (prevChar === '/' || prevChar === '=') {
                    continue;
                }

                const hashtag = `#${tag}`;
                const key = hashtag.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                result.push(hashtag);
            }
        };

        collect(description);
        collect(extended);

        return result;
    };

    /**
     * ユーザーが手で入力した既存のハッシュタグ・局タグ・番組タグを 1 つのハッシュタグ一覧に合成する
     *
     * 合成順は `base` → 局タグ → 番組タグ。大文字小文字を区別せず重複を除き、初出の表記を残す。
     * **自動で追記する局タグ・番組タグは全角英数字を半角へ揃える**が、ユーザーが手で入力した `base` の
     * 表記はそのまま尊重する (重複判定だけは半角へ揃えて行うので、`#ＡＢＣ` と `#ABC` が二重に並ぶことはない)
     * @param base 既に入力欄にあるハッシュタグ (先頭 `#` の有無は問わない)
     * @param channelTag `getChannelHashtag()` で得た局タグ (無ければ null)
     * @param programTags `extractProgramHashtags()` で得た番組タグ
     * @param options 局タグ・番組タグを合成対象に含めるかどうか
     * @return string[] 合成後のハッシュタグ一覧 (すべて先頭 `#` 付き)
     */
    export const composeHashtags = (
        base: string[],
        channelTag: string | null,
        programTags: string[],
        options: ComposeHashtagsOptions = {},
    ): string[] => {
        const { includeChannelHashtag = true, includeProgramHashtags = true } = options;

        // base はユーザーが手で入力したものなので表記をそのまま尊重する。
        // 局タグ・番組タグは自動で追記するものなので半角表記へ揃える
        const source: string[] = [...base];
        if (includeChannelHashtag && channelTag !== null) {
            source.push(toHalfWidthAlnum(channelTag));
        }
        if (includeProgramHashtags) {
            source.push(...programTags.map(toHalfWidthAlnum));
        }

        const seen = new Set<string>();
        const result: string[] = [];
        for (const raw of source) {
            if (raw.trim().length === 0) {
                continue;
            }

            const hashtag = toHalfWidthHashtag(raw.trim());
            // 手入力の「#ＡＢＣ」と自動追記の「#ABC」が二重に並ばないよう、重複判定は半角へ揃えてから行う
            const key = toHalfWidthAlnum(hashtag).toLowerCase();
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            result.push(hashtag);
        }

        return result;
    };

    /**
     * ハッシュタグ一覧を本文へ差し込む
     *
     * KonomiTV `Twitter.vue` のハッシュタグ合成処理 (1133-1153 行目) 相当。
     * `hashtags` が空のときは `text` をそのまま返す
     * @param text 投稿本文
     * @param hashtags 差し込むハッシュタグ一覧 (`applyHashtags` 自体は正規化しないので事前に整えておくこと)
     * @param position 差し込み位置 (既定 `'append'`)
     * @return string ハッシュタグを差し込んだ本文
     */
    export const applyHashtags = (text: string, hashtags: string[], position: HashtagPosition = 'append'): string => {
        if (hashtags.length === 0) {
            return text;
        }

        const hashtagText = hashtags.join(' ');

        switch (position) {
            case 'prepend':
                return `${hashtagText} ${text}`;
            case 'prependWithLineBreak':
                return `${hashtagText}\n${text}`;
            case 'appendWithLineBreak':
                return `${text}\n${hashtagText}`;
            case 'append':
            default:
                return `${text} ${hashtagText}`;
        }
    };

    /**
     * ハッシュタグ入力欄の生テキストを正規化してハッシュタグの配列にする
     *
     * KonomiTV `Twitter.vue` の `formatHashtag()` (1072-1099 行目) 相当。
     * 全角 `＃` / `♯` を半角 `#` へ揃え、連続する `#` を 1 つへ圧縮し、
     * 全角スペースを含む空白区切りで分割する。`#` が付いていない語には補って付与する
     * (視聴中チャンネルの局タグ自動付与は `composeHashtags()` 側の責務なのでここでは行わない)
     * @param input ハッシュタグ入力欄の生テキスト (例: `"＃nhk  ##etv 手動タグ"`)
     * @return string[] 正規化されたハッシュタグ一覧 (すべて先頭 `#` 付き)
     */
    export const normalizeHashtagInput = (input: string): string[] => {
        return input
            .trim()
            .replaceAll('♯', '#')
            .replaceAll('＃', '#')
            .replace(/#{2,}/g, '#')
            .replaceAll('　', ' ')
            .replace(/ +/g, ' ')
            .split(' ')
            .filter(tag => tag !== '')
            .map(tag => (tag.startsWith('#') ? tag : `#${tag}`));
    };
}

export default ProgramHashtagUtil;
