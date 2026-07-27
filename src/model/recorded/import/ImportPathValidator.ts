import * as fs from 'fs';
import * as path from 'path';

/**
 * 外部録画ファイル取り込み機能のパス検証を行う純粋関数群
 *
 * DI コンテナに登録するクラスではなく、単体テストが書きやすいようにプレーンな関数として実装している。
 * (セキュリティ上重要なロジックのため、副作用を最小限にして UT で境界値を網羅できるようにする)
 */
namespace ImportPathValidator {
    export interface ImportDirEntry {
        name: string;
        path: string;
    }

    export interface ResolvedImportPath {
        // シンボリックリンクを解決した実ファイルパス
        realPath: string;
        // 一致した importDirs のエントリ名
        dirName: string;
        // 一致した importDirs エントリの実ディレクトリパスから見た相対パス
        relativePath: string;
    }

    /**
     * サブディレクトリ指定にディレクトリトラバーサルが含まれていないか検証する
     * 絶対パス指定・`..` セグメント・null byte を禁止する
     * Windows / POSIX どちらの区切り文字でも判定できるようにする
     * @param subDirectory: string
     * @throws InvalidSubDirectory
     */
    export function validateSubDirectory(subDirectory: string): void {
        if (subDirectory.length === 0) {
            return;
        }

        if (subDirectory.includes('\u0000')) {
            throw new Error('InvalidSubDirectory');
        }

        // Windows のドライブレター指定 (C:\...) や UNC パス (\\host\...) も禁止する
        if (path.win32.isAbsolute(subDirectory) || path.posix.isAbsolute(subDirectory)) {
            throw new Error('InvalidSubDirectory');
        }

        const segments = subDirectory.split(/[\\/]/);
        for (const segment of segments) {
            if (segment === '..') {
                throw new Error('InvalidSubDirectory');
            }
        }
    }

    /**
     * 指定パスが importDirs のいずれかの配下にあるかを検証し、シンボリックリンク解決後の実パスを返す
     * realpath ベースで検証するためシンボリックリンクによる importDirs 外への脱出を防げる
     * @param targetPath: string 検証対象の絶対パス
     * @param importDirs: ImportDirEntry[] 設定で許可されたディレクトリ一覧
     * @return Promise<ResolvedImportPath>
     * @throws ImportDirsNotConfigured importDirs が空の場合
     * @throws ImportPathNotAllowed importDirs 配下に存在しない場合
     */
    export async function resolveImportTargetPath(
        targetPath: string,
        importDirs: ImportDirEntry[],
    ): Promise<ResolvedImportPath> {
        if (importDirs.length === 0) {
            throw new Error('ImportDirsNotConfigured');
        }

        let realPath: string;
        try {
            realPath = await fs.promises.realpath(targetPath);
        } catch (err: any) {
            throw new Error('ImportPathNotFound');
        }

        for (const dir of importDirs) {
            let realDirPath: string;
            try {
                realDirPath = await fs.promises.realpath(dir.path);
            } catch (err: any) {
                // importDirs に存在しないディレクトリが設定されている場合は無視して次を試す
                continue;
            }

            const relative = path.relative(realDirPath, realPath);

            // path.relative が '..' で始まる、または絶対パスになる場合は配下ではない
            // 大文字小文字・区切り文字に依存しないよう path.relative の結果のみで判定する (Windows は大文字小文字を区別しないが
            // realpath がドライブレター等を正規化してくれるため、ここでは追加の toLowerCase は行わない)
            if (
                relative === '' ||
                (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
            ) {
                return {
                    realPath,
                    dirName: dir.name,
                    relativePath: relative,
                };
            }
        }

        throw new Error('ImportPathNotAllowed');
    }
}

export default ImportPathValidator;
