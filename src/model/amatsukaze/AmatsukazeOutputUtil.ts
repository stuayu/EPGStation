import * as fs from 'fs';
import * as path from 'path';

/**
 * Amatsukaze の出力ファイルを探すためのユーティリティ。
 *
 * Amatsukaze のバージョンによっては、タスクが完了しても `ActualDstPath` (実際の出力パス) が
 * 返らず、拡張子の付かない `DstPath` (ベース名) しか得られない。
 * 出力先には本編と同じベース名で字幕 (`.ass`) やチャプター (`.chapter.txt`) も並ぶため、
 * ベース名から本編だけを選び出す必要がある。
 */
namespace AmatsukazeOutputUtil {
    /**
     * 動画と一緒に出力される副産物の拡張子。
     * ベース名から出力ファイルを探すとき、本編と取り違えないよう除外する
     */
    export const SIDE_CAR_SUFFIXES = ['.chapter.txt', '.ass', '.srt', '.txt', '.log', '.json', '.xml'];

    /**
     * 副産物 (字幕・チャプターなど) のファイル名かどうか
     * @param name: string ベース名を除いた残りの部分 (先頭の "." を含む)
     * @return boolean
     */
    const isSideCar = (name: string): boolean => {
        const lower = name.toLowerCase();

        return SIDE_CAR_SUFFIXES.some(suffix => lower.endsWith(suffix));
    };

    /**
     * 出力ファイルパスのベース (拡張子なし) から、実際に出力された本編ファイルを探す。
     * 候補が複数ある場合は最も大きいものを本編とみなす
     * @param base: string 出力ファイルパスのベース (拡張子なし)
     * @return string | null 見つからない場合は null
     */
    export const findOutputByBase = (base: string): string | null => {
        const dir = path.dirname(base);
        const prefix = `${path.basename(base)}.`;

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (err: any) {
            return null;
        }

        let selected: { filePath: string; size: number } | null = null;
        for (const entry of entries) {
            if (entry.startsWith(prefix) === false) {
                continue;
            }
            if (isSideCar(entry.slice(prefix.length - 1)) === true) {
                continue;
            }

            const filePath = path.join(dir, entry);
            let size = 0;
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile() === false) {
                    continue;
                }
                size = stat.size;
            } catch (err: any) {
                continue;
            }

            if (selected === null || size > selected.size) {
                selected = { filePath: filePath, size: size };
            }
        }

        return selected === null ? null : selected.filePath;
    };

    /**
     * 動画ファイルパスから最後の拡張子を除いたベースを返す
     * (例: `foo.hevc.ts` → `foo.hevc`)
     * @param videoPath: string
     * @return string
     */
    export const getBasePath = (videoPath: string): string => {
        const extension = path.extname(videoPath);

        return extension.length === 0 ? videoPath : videoPath.slice(0, videoPath.length - extension.length);
    };

    /**
     * 動画ファイルに付随する副産物 (チャプター・字幕) を列挙する。
     *
     * 副産物は動画の**最後の拡張子を差し替えた**名前で出力される
     * (`foo.hevc.ts` に対して `foo.hevc.chapter.txt` / `foo.hevc.ass`)。
     * 動画の名前を変えて移動するときはこれらも合わせて運ばないと、
     * チャプター (`ChapterFileUtil` が同じ規則で探す) が拾えなくなる
     * @param videoPath: string 動画ファイルのパス
     * @return { filePath: string; suffix: string }[] suffix はベース (最後の拡張子を除いた部分) を除いた残り
     */
    export const listSideCarFiles = (videoPath: string): { filePath: string; suffix: string }[] => {
        const dir = path.dirname(videoPath);
        const videoName = path.basename(videoPath);
        const baseName = path.basename(getBasePath(videoPath));

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (err: any) {
            return [];
        }

        const result: { filePath: string; suffix: string }[] = [];
        for (const entry of entries) {
            if (entry === videoName || entry.startsWith(`${baseName}.`) === false) {
                continue;
            }

            const suffix = entry.slice(baseName.length);
            if (isSideCar(suffix) === false) {
                continue;
            }

            result.push({ filePath: path.join(dir, entry), suffix: suffix });
        }

        return result;
    };
}

export default AmatsukazeOutputUtil;
