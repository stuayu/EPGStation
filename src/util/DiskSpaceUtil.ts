import * as fs from 'fs';

/**
 * ディスクの空き容量取得。
 *
 * 以前はネイティブモジュール `diskusage-ng` を使っていたが、Node.js 標準の
 * `fs.statfs` (Node 18.15 / 19.6 以降) が Linux / macOS / **Windows** のいずれでも
 * 使えるためこちらへ寄せた。ネイティブビルドが不要になり、Windows で
 * node-gyp のビルド環境に左右されることもなくなる。
 *
 * Windows でも libuv が `GetDiskFreeSpaceEx` を呼ぶため、ドライブレター配下の
 * パスをそのまま渡せる (`D:\EPGStation\ts` など)。
 */
namespace DiskSpaceUtil {
    export interface DiskSpace {
        // 使用可能な空き容量 (byte)。非特権ユーザーが実際に書ける量
        available: number;
        // 全体の容量 (byte)
        total: number;
        // 使用中の容量 (byte)
        used: number;
    }

    /**
     * 指定パスが属するファイルシステムの容量を取得する
     * @param dirPath: string 対象のディレクトリパス
     * @return Promise<DiskSpace>
     * @throws パスが存在しない場合など (ENOENT)
     */
    export const get = async (dirPath: string): Promise<DiskSpace> => {
        const stat = await fs.promises.statfs(dirPath);

        // bsize はブロックサイズ。bavail は非特権ユーザーが使えるブロック数で、
        // bfree (予約分を含む空き) ではなく bavail を「空き」として扱う
        const total = stat.blocks * stat.bsize;
        const available = stat.bavail * stat.bsize;

        return {
            available: available,
            total: total,
            used: total - stat.bfree * stat.bsize,
        };
    };

    /**
     * 空き容量だけを取得する。取得できない場合は null を返す
     * @param dirPath: string
     * @return Promise<number | null> 空き容量 (byte)
     */
    export const getAvailable = async (dirPath: string): Promise<number | null> => {
        try {
            return (await get(dirPath)).available;
        } catch (err: any) {
            return null;
        }
    };
}

export default DiskSpaceUtil;
