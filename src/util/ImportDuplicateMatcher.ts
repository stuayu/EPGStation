import * as fs from 'fs';
import * as path from 'path';
import * as apid from '../../api';
import { getMirakurunProgramId } from '../model/api/schedule/EitOnAirResolver';
import { TsInfo } from '../model/recorded/ts/ITsInfoAnalyzer';
import { BRACKET_MARKERS } from '../model/series/SeriesNormalizer';
import StrUtil from './StrUtil';

export interface ImportDuplicateCandidate {
    id: apid.RecordedId;
    channelId: apid.ChannelId;
    startAt: number;
    name: string;
    programId?: apid.ProgramId | null;
}

export interface ImportDuplicateMatchInput {
    channelId: apid.ChannelId;
    startAt: number;
    name: string;
    tsInfo?: Pick<TsInfo, 'networkId' | 'serviceId' | 'eventId'> | null;
}

export interface ImportDuplicateMatchResult {
    duplicateRecordedIds: apid.RecordedId[];
    matchedRecordedId: apid.RecordedId | null;
    programId: apid.ProgramId | null;
}

/**
 * 外部録画ファイルの番組名を重複判定用の表記へ正規化する。
 * EPGStation の番組表と同じ半角化・放送マーカー除去を行い、空白と大小文字の差を無視する。
 * @param name: string 番組名
 * @return string 正規化済み番組名
 */
export const normalizeImportProgramName = (name: string): string =>
    StrUtil.deleteEnclosedCharacters(StrUtil.toHalf(name).normalize('NFKC'))
        .replace(BRACKET_MARKERS, ' ')
        .replace(/\s+/gu, '')
        .toLowerCase();

/**
 * Mirakurun の networkId/serviceId/eventId から programId を生成する。
 * @param tsInfo: Pick<TsInfo, 'networkId' | 'serviceId' | 'eventId'> | null
 * @return apid.ProgramId | null 識別子が揃わない場合は null
 */
export const getImportProgramId = (
    tsInfo: Pick<TsInfo, 'networkId' | 'serviceId' | 'eventId'> | null | undefined,
): apid.ProgramId | null => {
    if (tsInfo?.networkId === null || tsInfo?.networkId === undefined) return null;
    if (tsInfo.serviceId === null || tsInfo.serviceId === undefined) return null;
    if (tsInfo.eventId === null || tsInfo.eventId === undefined) return null;

    return getMirakurunProgramId(tsInfo.networkId, tsInfo.serviceId, tsInfo.eventId);
};

/**
 * 外部録画ファイルと既存録画の重複を判定する。
 * programId、または同一局・許容時刻内・正規化済み番組名の一致が候補1件だけなら強一致。
 * @param input: ImportDuplicateMatchInput 取り込みファイルの推定情報
 * @param candidates: ImportDuplicateCandidate[] 時刻・局で絞った既存録画候補
 * @param toleranceMs: number 開始時刻の許容差
 * @return ImportDuplicateMatchResult 判定結果
 */
export const matchImportDuplicate = (
    input: ImportDuplicateMatchInput,
    candidates: ImportDuplicateCandidate[],
    toleranceMs: number,
): ImportDuplicateMatchResult => {
    const duplicateRecordedIds = candidates.map(candidate => candidate.id);
    const programId = getImportProgramId(input.tsInfo);

    if (programId !== null) {
        const programMatches = candidates.filter(
            candidate =>
                candidate.programId !== null &&
                typeof candidate.programId !== 'undefined' &&
                Number(candidate.programId) === programId,
        );
        if (programMatches.length === 1) {
            return { duplicateRecordedIds, matchedRecordedId: programMatches[0].id, programId };
        }
    }

    const normalizedName = normalizeImportProgramName(input.name);
    const nameMatches = candidates.filter(
        candidate =>
            candidate.channelId === input.channelId &&
            Math.abs(candidate.startAt - input.startAt) <= toleranceMs &&
            normalizedName !== '' &&
            normalizeImportProgramName(candidate.name) === normalizedName &&
            (programId === null ||
                candidate.programId === null ||
                typeof candidate.programId === 'undefined' ||
                Number(candidate.programId) === programId),
    );
    if (candidates.length === 1 && nameMatches.length === 1) {
        return { duplicateRecordedIds, matchedRecordedId: nameMatches[0].id, programId };
    }

    return { duplicateRecordedIds, matchedRecordedId: null, programId };
};

/**
 * OS に依存せずファイルパスを比較用の表記へ変換する。
 * Windows 形式のパスは区切り文字と大文字小文字を無視し、POSIX は大文字小文字を保持する。
 * @param filePath: string ファイルパス
 * @return string 比較用パス
 */
export const normalizeImportFilePath = (filePath: string): string => {
    const isWindowsPath = /^[A-Za-z]:[\\/]/u.test(filePath) || filePath.startsWith('\\\\') || filePath.includes('\\');
    if (isWindowsPath) {
        return path.win32
            .normalize(filePath)
            .replace(/[\\/]+$/u, '')
            .toLowerCase();
    }

    return path.resolve(filePath).replace(/\/+$/u, '');
};

/**
 * 2つの録画ファイルパスが同一か判定する。
 * @param left: string ファイルパス
 * @param right: string ファイルパス
 * @return boolean 同一ファイルなら true
 */
export const isSameImportFilePath = (left: string, right: string): boolean =>
    normalizeImportFilePath(left) === normalizeImportFilePath(right);

/**
 * ファイルが存在する場合はシンボリックリンクを解決して比較用パスを返す。
 * @param filePath: string ファイルパス
 * @return Promise<string> 実体を解決したパス、解決できない場合は入力パス
 */
export const resolveImportFilePath = async (filePath: string): Promise<string> =>
    await fs.promises.realpath(filePath).catch(() => filePath);

export interface ImportedVideoFilePath {
    filePath: string;
    videoFileId: apid.VideoFileId;
    recordedId: apid.RecordedId;
}

/**
 * 登録済み video_file のパスから、比較用パス → video_file の索引を作る。
 * realpath はディレクトリ単位で 1 回だけ解決する (録画数ぶん realpath を呼ぶと
 * ネットワークドライブ上で数千回のファイルシステム呼び出しになるため)。
 * ファイル名部分のシンボリックリンクは解決しない。
 * @param files: ImportedVideoFilePath[] 登録済みファイル
 * @return Promise<Map<string, ImportedVideoFilePath>> 比較用パスをキーにした索引
 */
export const buildImportedVideoFilePathIndex = async (
    files: ImportedVideoFilePath[],
): Promise<Map<string, ImportedVideoFilePath>> => {
    const dirCache = new Map<string, string>();
    const result = new Map<string, ImportedVideoFilePath>();
    for (const file of files) {
        const dir = path.dirname(file.filePath);
        let realDir = dirCache.get(dir);
        if (typeof realDir === 'undefined') {
            realDir = await resolveImportFilePath(dir);
            dirCache.set(dir, realDir);
        }
        result.set(normalizeImportFilePath(path.join(realDir, path.basename(file.filePath))), file);
    }

    return result;
};
