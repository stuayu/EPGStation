import * as path from 'path';

/**
 * PSI/SI を解析できる外部録画ファイルの拡張子。
 * MPEG-PS (.m2p) は PSI/SI を持たないため含めない。
 */
export const IMPORT_TS_FILE_EXTENSIONS = ['.ts', '.m2ts', '.mts', '.m2t'] as const;

/**
 * ファイル名が PSI/SI 解析対象か判定する。
 * @param filePath: string ファイルパス
 * @return boolean PSI/SI 解析対象なら true
 */
export const isImportTsFile = (filePath: string): boolean => {
    const lowerExtension = path.extname(filePath).toLowerCase();

    return (IMPORT_TS_FILE_EXTENSIONS as readonly string[]).includes(lowerExtension);
};
