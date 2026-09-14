// このモジュールはクライアント (OfflineStreamParser 経由) からも読み込まれる。
// ブラウザには Buffer が無いため、モジュール先頭で Buffer を評価すると Web UI 全体が起動しなくなる。
// Buffer は関数の中でだけ使い、定数はサーバ側で使うときに初めて作る。
export const OFFLINE_STREAM_MAGIC_TEXT = 'EPGODL2\n';
export const getOfflineStreamMagic = (): Buffer => Buffer.from(OFFLINE_STREAM_MAGIC_TEXT, 'ascii');

export type OfflineStreamRecordType = 'init' | 'master' | 'segment' | 'end';
export type OfflineStreamRole = 'single' | 'video' | 'audio0' | 'audio1';

const RECORD_HEADER_BYTES = 16;
const recordTypeValue: Record<OfflineStreamRecordType, number> = { init: 1, master: 2, segment: 3, end: 0xff };
const roleValue: Record<OfflineStreamRole, number> = { single: 0, video: 1, audio0: 2, audio1: 3 };

const createRecordHeader = (
    type: OfflineStreamRecordType,
    role: OfflineStreamRole,
    sequence: number,
    durationMilliseconds: number,
    length: number,
): Buffer => {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 0xffffffff)
        throw new Error('OfflineSequenceInvalid');
    if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 0 || durationMilliseconds > 0xffffffff)
        throw new Error('OfflineDurationInvalid');
    if (!Number.isSafeInteger(length) || length <= 0 || length > 0xffffffff)
        throw new Error('OfflineRecordLengthInvalid');
    const header = Buffer.alloc(RECORD_HEADER_BYTES);
    header.writeUInt8(recordTypeValue[type], 0);
    header.writeUInt8(roleValue[role], 1);
    header.writeUInt32BE(sequence, 4);
    header.writeUInt32BE(durationMilliseconds, 8);
    header.writeUInt32BE(length, 12);
    return header;
};

export const createOfflineInitRecord = (role: OfflineStreamRole, data: Buffer): Buffer =>
    Buffer.concat([createRecordHeader('init', role, 0, 0, data.length), data]);

export const createOfflineMasterRecord = (data: Buffer): Buffer =>
    Buffer.concat([createRecordHeader('master', 'single', 0, 0, data.length), data]);

export const createOfflineSegmentRecord = (
    role: OfflineStreamRole,
    sequence: number,
    durationMilliseconds: number,
    data: Buffer,
): Buffer => Buffer.concat([createRecordHeader('segment', role, sequence, durationMilliseconds, data.length), data]);

export const createOfflineEndRecord = (segmentCount: number): Buffer => {
    if (!Number.isSafeInteger(segmentCount) || segmentCount < 0 || segmentCount > 0xffffffff)
        throw new Error('OfflineRecordCountInvalid');
    const record = Buffer.alloc(RECORD_HEADER_BYTES);
    record.writeUInt8(recordTypeValue.end, 0);
    record.writeUInt32BE(segmentCount, 4);
    return record;
};

export const getOfflineRecordHeaderBytes = (): number => RECORD_HEADER_BYTES;
