import * as path from 'path';
import * as apid from '../../api';

/**
 * 動画ファイルの横に置かれるチャプターファイル (`<動画ファイル名>.chapter.txt`) を扱う。
 *
 * MPEG-TS コンテナはチャプターを埋め込めないため、Amatsukaze の tsreplace 出力のように
 * `.ts` のまま残す構成では、チャプターが別ファイルとして書き出される。
 * ffprobe からは読めないので、こちらを読んで補う。
 *
 * 形式は Ogg / Matroska の simple chapter format:
 *
 * ```
 * CHAPTER01=00:00:00.000
 * CHAPTER01NAME=A
 * CHAPTER02=00:00:22.155
 * CHAPTER02NAME=CM
 * ```
 */
namespace ChapterFileUtil {
    // 動画ファイルの拡張子を置き換えて使うチャプターファイルの接尾辞
    export const CHAPTER_FILE_SUFFIX = '.chapter.txt';

    // CHAPTER01=00:00:00.000 / CHAPTER01NAME=A の両方に一致する
    const LINE_REGEXP = /^\s*CHAPTER(\d+)(NAME)?\s*=\s*(.*?)\s*$/i;
    // HH:MM:SS.mmm (時・ミリ秒は省略可)
    const TIME_REGEXP = /^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/;
    // 改行コード (CRLF / LF どちらでも行に分割できるようにする)
    const LINE_SPLIT_REGEXP = /\r?\n/;
    // BOM (U+FEFF)。1 文字目に付いていると CHAPTER01 の照合に失敗するため取り除く
    const BOM = String.fromCharCode(0xfeff);

    /**
     * 先頭の BOM を取り除く
     * @param content: string
     * @return string
     */
    const stripBom = (content: string): string => (content.charAt(0) === BOM ? content.slice(BOM.length) : content);

    interface ChapterEntry {
        startAt: number;
        title: string | null;
    }

    /**
     * 動画ファイルに対応するチャプターファイルのパスを返す。
     * 動画ファイルの**最後の拡張子だけ**を差し替える
     * (例: `foo.hevc.ts` → `foo.hevc.chapter.txt`)
     * @param videoFilePath: string
     * @return string
     */
    export const getChapterFilePath = (videoFilePath: string): string => {
        const ext = path.extname(videoFilePath);

        return `${videoFilePath.slice(0, videoFilePath.length - ext.length)}${CHAPTER_FILE_SUFFIX}`;
    };

    /**
     * `HH:MM:SS.mmm` 形式の時刻を秒へ変換する
     * @param value: string
     * @return number | null 解釈できない場合は null
     */
    const parseTime = (value: string): number | null => {
        const matched = value.match(TIME_REGEXP);
        if (matched === null) {
            return null;
        }

        const hours = typeof matched[1] === 'undefined' ? 0 : parseInt(matched[1], 10);
        const minutes = parseInt(matched[2], 10);
        const seconds = parseInt(matched[3], 10);
        // 小数部は桁数がまちまちなので、そのまま小数として解釈する (".155" → 0.155)
        const fraction = typeof matched[4] === 'undefined' ? 0 : parseFloat(`0.${matched[4]}`);

        return hours * 3600 + minutes * 60 + seconds + fraction;
    };

    /**
     * チャプターファイルの内容を解析する。
     *
     * `endAt` はファイルに書かれていないため次のチャプターの開始位置で埋める。
     * 最後のチャプターは動画全体の長さを使う (不明なら開始位置と同じ値になる)
     * @param content: string チャプターファイルの中身
     * @param duration?: number 動画全体の長さ (秒)
     * @return apid.VideoChapter[] 開始位置の昇順。1 件も読めなければ空配列
     */
    export const parse = (content: string, duration?: number): apid.VideoChapter[] => {
        const entries = new Map<number, ChapterEntry>();

        // BOM (U+FEFF) を落としてから行単位で読む (CRLF / LF どちらでも動くようにする)
        for (const line of stripBom(content).split(LINE_SPLIT_REGEXP)) {
            const matched = line.match(LINE_REGEXP);
            if (matched === null) {
                continue;
            }

            const index = parseInt(matched[1], 10);
            const isName = typeof matched[2] !== 'undefined';
            const value = matched[3];
            const entry = entries.get(index) ?? { startAt: -1, title: null };

            if (isName === true) {
                entry.title = value.length > 0 ? value : null;
            } else {
                const startAt = parseTime(value);
                if (startAt === null) {
                    continue;
                }
                entry.startAt = startAt;
            }

            entries.set(index, entry);
        }

        // 開始位置を読めなかった項目 (NAME 行しか無い等) は捨てる
        const sorted = Array.from(entries.values())
            .filter(entry => entry.startAt >= 0)
            .sort((a, b) => a.startAt - b.startAt);

        return sorted.map((entry, index) => {
            const next = sorted[index + 1];
            const endAt =
                typeof next === 'undefined'
                    ? typeof duration === 'number' && duration > entry.startAt
                        ? duration
                        : entry.startAt
                    : next.startAt;

            return {
                id: index,
                startAt: entry.startAt,
                endAt: endAt,
                title: entry.title,
            };
        });
    };
}

export default ChapterFileUtil;
