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
}

export default AmatsukazeOutputUtil;
