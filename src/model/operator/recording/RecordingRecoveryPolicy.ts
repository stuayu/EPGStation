export interface RecordingRecoveryInput {
    now: number;
    endAt: number;
    endMarginMs: number;
    hasReserve: boolean;
    fileExists: boolean;
}

/** 再起動後に既存録画へ追記できるか判定する。 */
export const canResumeRecording = (input: RecordingRecoveryInput): boolean =>
    input.hasReserve && input.fileExists && input.now < input.endAt + input.endMarginMs;

/** TS ファイル末尾の不完全なパケットを除いたサイズを返す。 */
export const getAlignedRecordingSize = (size: number, packetSize: number = 188): number =>
    Math.max(0, size - (size % packetSize));
