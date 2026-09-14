import { getOfflineRecordHeaderBytes, OfflineStreamRole } from './OfflineStreamProtocol';

export interface OfflineStreamMetadata {
    videoFileId: number;
    fileSize: number;
    duration: number;
    profile: string;
    formatVersion: 2;
}

export interface OfflineInitRecord {
    role: OfflineStreamRole;
    data: Uint8Array;
}

export interface OfflineSegmentRecord {
    role: OfflineStreamRole;
    sequence: number;
    duration: number;
    data: Uint8Array;
}

export type OfflineStreamEvent =
    | { type: 'metadata'; metadata: OfflineStreamMetadata }
    | { type: 'init'; init: OfflineInitRecord }
    | { type: 'master'; data: Uint8Array }
    | { type: 'segment'; segment: OfflineSegmentRecord }
    | { type: 'end'; recordCount: number };

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024 * 1024;
const MAGIC = new TextEncoder().encode('EPGODL2\n');
const roles: OfflineStreamRole[] = ['single', 'video', 'audio0', 'audio1'];

const getRole = (value: number): OfflineStreamRole => {
    const role = roles[value];
    if (typeof role === 'undefined') throw new Error('オフライン保存データのロールが不正です。');
    return role;
};

/** ネットワークチャンク境界に依存せず、1 レコードずつ fMP4 保存形式を復元するパーサー。 */
export default class OfflineStreamParser {
    private pending = new Uint8Array(0);
    private maxPendingBytes = 0;
    private magicRead = false;
    private metadata: OfflineStreamMetadata | null = null;
    private nextSequence = new Map<OfflineStreamRole, number>();
    private initializedRoles = new Set<OfflineStreamRole>();
    private masterRead = false;
    private recordCount = 0;
    private ended = false;

    public push(chunk: Uint8Array): OfflineStreamEvent[] {
        if (this.ended === true) throw new Error('オフライン保存ストリームが終端後も続いています。');
        if (chunk.length === 0) return [];
        const source =
            this.pending.length === 0
                ? chunk
                : (() => {
                      const merged = new Uint8Array(this.pending.length + chunk.length);
                      merged.set(this.pending);
                      merged.set(chunk, this.pending.length);
                      return merged;
                  })();
        this.pending = new Uint8Array(0);
        return this.parseAvailable(source);
    }

    /** 解析中に保持した最大バイト数を返す (診断・回帰テスト用)。 */
    public getMaxPendingBytes(): number {
        return this.maxPendingBytes;
    }

    public finish(): void {
        if (this.ended === false || this.pending.length !== 0)
            throw new Error('オフライン保存ストリームが途中で終了しました。');
    }

    private parseAvailable(source: Uint8Array): OfflineStreamEvent[] {
        const events: OfflineStreamEvent[] = [];
        let offset = 0;
        const remaining = (): number => source.length - offset;
        const retain = (): void => {
            this.pending = source.slice(offset);
            this.maxPendingBytes = Math.max(this.maxPendingBytes, this.pending.length);
        };
        if (this.magicRead === false) {
            if (remaining() < MAGIC.length) {
                retain();
                return events;
            }
            if (MAGIC.some((value, index) => source[offset + index] !== value))
                throw new Error('オフライン保存データの形式を認識できません。');
            offset += MAGIC.length;
            this.magicRead = true;
        }
        if (this.metadata === null) {
            if (remaining() < 4) {
                retain();
                return events;
            }
            const metadataLength = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0);
            if (metadataLength === 0 || metadataLength > MAX_METADATA_BYTES)
                throw new Error('オフライン保存データのメタデータ長が不正です。');
            if (remaining() < 4 + metadataLength) {
                retain();
                return events;
            }
            const metadata = JSON.parse(
                new TextDecoder().decode(source.subarray(offset + 4, offset + 4 + metadataLength)),
            ) as Partial<OfflineStreamMetadata>;
            if (
                !Number.isSafeInteger(metadata.videoFileId) ||
                typeof metadata.fileSize !== 'number' ||
                metadata.fileSize < 0 ||
                typeof metadata.duration !== 'number' ||
                metadata.duration <= 0 ||
                typeof metadata.profile !== 'string' ||
                metadata.profile.length === 0 ||
                metadata.formatVersion !== 2
            ) {
                throw new Error('オフライン保存データのメタデータが不正です。');
            }
            this.metadata = metadata as OfflineStreamMetadata;
            offset += 4 + metadataLength;
            events.push({ type: 'metadata', metadata: this.metadata });
        }
        const headerBytes = getOfflineRecordHeaderBytes();
        if (remaining() < headerBytes) {
            retain();
            return events;
        }
        while (remaining() >= headerBytes) {
            const view = new DataView(source.buffer, source.byteOffset + offset, headerBytes);
            const type = view.getUint8(0);
            const role = getRole(view.getUint8(1));
            const sequence = view.getUint32(4);
            const durationMilliseconds = view.getUint32(8);
            const length = view.getUint32(12);
            if (type === 0xff) {
                if (sequence !== this.recordCount || durationMilliseconds !== 0 || length !== 0)
                    throw new Error('オフライン保存データの終端レコードが不正です。');
                offset += headerBytes;
                this.ended = true;
                events.push({ type: 'end', recordCount: sequence });
                if (remaining() !== 0) throw new Error('オフライン保存ストリームが終端後も続いています。');
                break;
            }
            if (type !== 1 && type !== 2 && type !== 3)
                throw new Error('オフライン保存データのレコード種別が不正です。');
            if (length === 0 || length > MAX_RECORD_BYTES)
                throw new Error('オフライン保存データのレコード長が不正です。');
            if (remaining() < headerBytes + length) {
                retain();
                break;
            }
            const data = source.subarray(offset + headerBytes, offset + headerBytes + length);
            offset += headerBytes + length;
            if (type === 1) {
                if (sequence !== 0 || durationMilliseconds !== 0 || this.initializedRoles.has(role))
                    throw new Error('オフライン保存データの init が不正です。');
                this.initializedRoles.add(role);
                events.push({ type: 'init', init: { role, data } });
            } else if (type === 2) {
                if (role !== 'single' || sequence !== 0 || durationMilliseconds !== 0 || this.masterRead)
                    throw new Error('オフライン保存データの master が不正です。');
                this.masterRead = true;
                events.push({ type: 'master', data });
            } else {
                if (this.masterRead === false || this.initializedRoles.has(role) === false)
                    throw new Error('オフライン保存データのセグメント順序が不正です。');
                const expected = this.nextSequence.get(role) ?? 0;
                if (sequence !== expected || durationMilliseconds === 0)
                    throw new Error('オフライン保存データのセグメントが不正です。');
                this.nextSequence.set(role, expected + 1);
                events.push({
                    type: 'segment',
                    segment: { role, sequence, duration: durationMilliseconds / 1000, data },
                });
            }
            this.recordCount += 1;
        }
        if (this.ended === false && remaining() > 0) retain();
        else if (this.ended === false) this.pending = new Uint8Array(0);
        return events;
    }
}
