import * as fs from 'fs';
import * as path from 'path';

/**
 * importDirs 配下のディレクトリを走査し、取り込み候補となる動画ファイルを列挙する
 * DI を伴わないプレーンな関数群 (ImportPathValidator と同様の理由)
 */
namespace ImportDirectoryScanner {
    export interface CandidateFile {
        filePath: string; // 絶対パス (realpath 済み)
        fileName: string; // ファイル名 (拡張子込み)
        programTxtPath: string | null; // 同名の .program.txt が存在すればそのパス
        errPath: string | null; // 同名の .err が存在すればそのパス
    }

    // 取り込み対象として扱う動画ファイルの拡張子
    export const VIDEO_EXTENSIONS = ['.ts', '.m2ts', '.mp4', '.mkv', '.m2p'];

    /**
     * 指定ディレクトリ配下を再帰的に走査し、動画ファイル候補を返す
     * @param dirPath: string 走査対象の実ディレクトリパス (validate 済みであること)
     * @param recursive: boolean サブディレクトリも走査するか (既定 true)
     * @return Promise<CandidateFile[]>
     */
    export async function scan(dirPath: string, recursive: boolean = true): Promise<CandidateFile[]> {
        const result: CandidateFile[] = [];

        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        } catch (err: any) {
            return result;
        }

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory() === true) {
                if (recursive === true) {
                    const children = await scan(fullPath, recursive);
                    Array.prototype.push.apply(result, children);
                }
                continue;
            }

            if (entry.isFile() === false) {
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            if (VIDEO_EXTENSIONS.includes(ext) === false) {
                continue;
            }

            const programTxtPath = `${fullPath}.program.txt`;
            const errPath = `${fullPath}.err`;

            result.push({
                filePath: fullPath,
                fileName: entry.name,
                programTxtPath: (await exists(programTxtPath)) === true ? programTxtPath : null,
                errPath: (await exists(errPath)) === true ? errPath : null,
            });
        }

        return result;
    }

    async function exists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.stat(filePath);

            return true;
        } catch (err: any) {
            return false;
        }
    }
}

export default ImportDirectoryScanner;
