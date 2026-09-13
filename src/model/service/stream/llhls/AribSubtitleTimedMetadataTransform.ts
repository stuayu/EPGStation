import * as stream from 'stream';
import { AribId3Metadata } from './IAribId3Extractor';

/**
 * ARIB 字幕 ES を ID3 timed metadata ES へ変換する Transform
 *
 * arib-subtitle-timedmetadater は PMT の component_tag を 0x30〜0x37 / 0x87 に
 * 固定して字幕 ES を判定する。HEVC の TS では字幕の記述子構成が異なることが
 * あるため、stream_type=0x06 と subtitling_descriptor (0x59) も使って判定する。
 * 入力 TS はそのまま流し、必要なら PMT と ID3 PES を追加する。
 */
class AribSubtitleTimedMetadataTransform extends stream.Transform {
    private buffer: Buffer = Buffer.alloc(0);
    private pmtPids: Set<number> = new Set();
    private subtitlePids: Set<number> = new Set();
    private subtitlePmtPids: Map<number, Set<number>> = new Map();
    private metadataPidByPmt: Map<number, number> = new Map();
    private metadataContinuityCounters: Map<number, number> = new Map();
    private sectionBuffers: Map<number, AribSubtitleTimedMetadataTransform.AssembleBuffer> = new Map();
    private sectionPackets: Map<number, Buffer[]> = new Map();
    private pesBuffers: Map<number, AribSubtitleTimedMetadataTransform.AssembleBuffer> = new Map();

    public _transform(chunk: Buffer, _encoding: string, callback: stream.TransformCallback): void {
        try {
            this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

            let offset = 0;
            while (offset + AribSubtitleTimedMetadataTransform.PACKET_SIZE <= this.buffer.length) {
                if (this.buffer[offset] !== AribSubtitleTimedMetadataTransform.SYNC_BYTE) {
                    offset += 1;
                    continue;
                }

                this.handlePacket(
                    this.buffer.subarray(offset, offset + AribSubtitleTimedMetadataTransform.PACKET_SIZE),
                );
                offset += AribSubtitleTimedMetadataTransform.PACKET_SIZE;
            }
            this.buffer = Buffer.from(this.buffer.subarray(offset));
        } catch (err) {
            callback(err as Error);

            return;
        }

        callback();
    }

    public _flush(callback: stream.TransformCallback): void {
        try {
            for (const pid of this.pesBuffers.keys()) {
                this.flushPes(pid);
            }
            for (const packets of this.sectionPackets.values()) {
                for (const packet of packets) {
                    this.push(packet);
                }
            }
            this.sectionPackets.clear();
            callback();
        } catch (err) {
            callback(err as Error);
        }
    }

    private handlePacket(packet: Buffer): void {
        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        const adaptationFieldControl = (packet[3] & 0x30) >> 4;
        const payloadOffset = this.getPayloadOffset(packet, adaptationFieldControl);

        if (payloadOffset < 0) {
            this.push(packet);

            return;
        }

        const payload = packet.subarray(payloadOffset);
        if (pid === AribSubtitleTimedMetadataTransform.PAT_PID) {
            const section = this.collectSection(pid, payload, payloadUnitStartIndicator);
            if (section !== null) {
                this.parsePat(section);
            }
            this.push(packet);

            return;
        }

        if (this.pmtPids.has(pid)) {
            const packets = this.sectionPackets.get(pid) ?? [];
            if (payloadUnitStartIndicator === true && packets.length > 0) {
                for (const previous of packets) {
                    this.push(previous);
                }
                packets.length = 0;
            }
            packets.push(Buffer.from(packet));
            this.sectionPackets.set(pid, packets);

            const section = this.collectSection(pid, payload, payloadUnitStartIndicator);
            if (section === null) {
                return;
            }

            this.sectionPackets.delete(pid);
            const rewritten = this.parsePmt(pid, section);
            const firstPacket = packets[0] ?? packet;
            for (const output of this.packetizeSection(pid, rewritten, firstPacket)) {
                this.push(output);
            }

            return;
        }

        if (this.subtitlePids.has(pid)) {
            this.collectPes(pid, payload, payloadUnitStartIndicator, packet);
        }

        this.push(packet);
    }

    private getPayloadOffset(packet: Buffer, adaptationFieldControl: number): number {
        if (adaptationFieldControl === 0 || adaptationFieldControl === 2) {
            return -1;
        }

        let offset = AribSubtitleTimedMetadataTransform.HEADER_SIZE;
        if (adaptationFieldControl === 3) {
            offset += packet[offset] + 1;
        }

        return offset < packet.length ? offset : -1;
    }

    private collectSection(pid: number, payload: Buffer, payloadUnitStartIndicator: boolean): Buffer | null {
        if (payloadUnitStartIndicator === true) {
            const pointerField = payload[0] ?? 0;
            const start = 1 + pointerField;
            if (start >= payload.length) {
                this.sectionBuffers.delete(pid);

                return null;
            }
            this.sectionBuffers.set(pid, {
                chunks: [Buffer.from(payload.subarray(start))],
                length: payload.length - start,
                expected: AribSubtitleTimedMetadataTransform.LENGTH_UNKNOWN,
            });
        } else {
            const assembling = this.sectionBuffers.get(pid);
            if (typeof assembling === 'undefined') {
                return null;
            }
            assembling.chunks.push(Buffer.from(payload));
            assembling.length += payload.length;
        }

        const assembling = this.sectionBuffers.get(pid);
        if (typeof assembling === 'undefined') {
            return null;
        }
        if (assembling.expected === AribSubtitleTimedMetadataTransform.LENGTH_UNKNOWN && assembling.length >= 3) {
            const head = Buffer.concat(assembling.chunks);
            assembling.expected = 3 + (((head[1] & 0x0f) << 8) | head[2]);
        }
        if (assembling.expected < 0 || assembling.length < assembling.expected) {
            return null;
        }

        this.sectionBuffers.delete(pid);

        return Buffer.concat(assembling.chunks).subarray(0, assembling.expected);
    }

    private parsePat(section: Buffer): void {
        if (section[0] !== 0x00) {
            return;
        }

        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = Math.min(section.length, 3 + sectionLength - 4);
        for (let i = 8; i + 4 <= end; i += 4) {
            const programNumber = (section[i] << 8) | section[i + 1];
            if (programNumber !== 0) {
                this.pmtPids.add(((section[i + 2] & 0x1f) << 8) | section[i + 3]);
            }
        }
    }

    private parsePmt(pmtPid: number, section: Buffer): Buffer {
        if (section[0] !== 0x02 || section.length < 12) {
            return section;
        }

        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = Math.min(section.length, 3 + sectionLength - 4);
        const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
        let offset = 12 + programInfoLength;
        let subtitlePid: number | null = null;
        let metadataPid: number | null = null;

        while (offset + 5 <= end) {
            const streamType = section[offset];
            const elementaryPid = ((section[offset + 1] & 0x1f) << 8) | section[offset + 2];
            const esInfoLength = ((section[offset + 3] & 0x0f) << 8) | section[offset + 4];
            const descriptorStart = offset + 5;
            const descriptorEnd = Math.min(end, descriptorStart + esInfoLength);
            let hasAribSubtitleDescriptor = false;
            let componentTag: number | null = null;

            for (let descriptor = descriptorStart; descriptor + 2 <= descriptorEnd;) {
                const tag = section[descriptor];
                const length = section[descriptor + 1];
                if (descriptor + 2 + length > descriptorEnd) {
                    break;
                }
                if (tag === 0x59) {
                    hasAribSubtitleDescriptor = true;
                } else if (tag === 0x52 && length >= 1) {
                    componentTag = section[descriptor + 2];
                }
                descriptor += 2 + length;
            }

            if (streamType === AribSubtitleTimedMetadataTransform.STREAM_TYPE_METADATA) {
                metadataPid = elementaryPid;
            }
            if (
                streamType === AribSubtitleTimedMetadataTransform.STREAM_TYPE_PRIVATE_DATA &&
                (hasAribSubtitleDescriptor || this.isSubtitleComponentTag(componentTag))
            ) {
                subtitlePid = elementaryPid;
            }
            offset = descriptorEnd;
        }

        if (subtitlePid === null) {
            this.removeSubtitlePid(pmtPid);

            return section;
        }

        this.addSubtitlePid(pmtPid, subtitlePid);
        if (metadataPid === null) {
            metadataPid = this.findFreeMetadataPid(section);
            this.metadataPidByPmt.set(pmtPid, metadataPid);
            this.metadataContinuityCounters.set(metadataPid, 0);

            return this.appendMetadataStream(section, metadataPid);
        }

        this.metadataPidByPmt.set(pmtPid, metadataPid);
        if (this.metadataContinuityCounters.has(metadataPid) === false) {
            this.metadataContinuityCounters.set(metadataPid, 0);
        }

        return section;
    }

    private isSubtitleComponentTag(componentTag: number | null): boolean {
        return (componentTag !== null && componentTag >= 0x30 && componentTag <= 0x37) || componentTag === 0x87;
    }

    private addSubtitlePid(pmtPid: number, subtitlePid: number): void {
        const oldPids = this.subtitlePmtPids.get(pmtPid) ?? new Set<number>();
        for (const oldPid of oldPids) {
            if (oldPid !== subtitlePid) {
                this.subtitlePids.delete(oldPid);
            }
        }
        oldPids.clear();
        oldPids.add(subtitlePid);
        this.subtitlePmtPids.set(pmtPid, oldPids);
        this.subtitlePids.add(subtitlePid);
    }

    private removeSubtitlePid(pmtPid: number): void {
        const oldPids = this.subtitlePmtPids.get(pmtPid);
        if (typeof oldPids === 'undefined') {
            return;
        }
        for (const oldPid of oldPids) {
            this.subtitlePids.delete(oldPid);
        }
        this.subtitlePmtPids.delete(pmtPid);
    }

    private findFreeMetadataPid(section: Buffer): number {
        const used = new Set<number>();
        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = Math.min(section.length, 3 + sectionLength - 4);
        const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
        for (let offset = 12 + programInfoLength; offset + 5 <= end;) {
            used.add(((section[offset + 1] & 0x1f) << 8) | section[offset + 2]);
            const esInfoLength = ((section[offset + 3] & 0x0f) << 8) | section[offset + 4];
            offset += 5 + esInfoLength;
        }

        for (let pid = 0x1ffe; pid > 0; pid -= 1) {
            if (used.has(pid) === false) {
                return pid;
            }
        }

        return 0x1ffe;
    }

    private appendMetadataStream(section: Buffer, metadataPid: number): Buffer {
        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = 3 + sectionLength - 4;
        const metadataStream = this.metadataElementaryStream(metadataPid);
        const newSectionLength = sectionLength + metadataStream.length;
        const result = Buffer.concat([section.subarray(0, end), metadataStream, Buffer.alloc(4)]);
        result[1] = (result[1] & 0xf0) | ((newSectionLength >> 8) & 0x0f);
        result[2] = newSectionLength & 0xff;
        const crc = AribSubtitleTimedMetadataTransform.crc32(result.subarray(0, result.length - 4));
        result.writeUInt32BE(crc >>> 0, result.length - 4);

        return result;
    }

    private metadataElementaryStream(pid: number): Buffer {
        const descriptor = Buffer.from([
            0x26, 0x0d, 0xff, 0xff, 0x49, 0x44, 0x33, 0x20, 0xff, 0x49, 0x44, 0x33, 0x20, 0xff, 0x0f,
        ]);
        const result = Buffer.alloc(5 + descriptor.length);
        result[0] = AribSubtitleTimedMetadataTransform.STREAM_TYPE_METADATA;
        result[1] = (pid >> 8) & 0x1f;
        result[2] = pid & 0xff;
        result[3] = (descriptor.length >> 8) & 0x0f;
        result[4] = descriptor.length & 0xff;
        descriptor.copy(result, 5);

        return result;
    }

    private packetizeSection(pid: number, section: Buffer, sourcePacket: Buffer): Buffer[] {
        const payload = Buffer.concat([Buffer.from([0]), section]);
        const result: Buffer[] = [];
        let offset = 0;
        let continuityCounter = sourcePacket[3] & 0x0f;
        while (offset < payload.length) {
            const packet = Buffer.alloc(AribSubtitleTimedMetadataTransform.PACKET_SIZE, 0xff);
            const first = offset === 0;
            packet[0] = AribSubtitleTimedMetadataTransform.SYNC_BYTE;
            packet[1] = (sourcePacket[1] & 0xa0) | (first ? 0x40 : 0) | ((pid >> 8) & 0x1f);
            packet[2] = pid & 0xff;
            packet[3] = (sourcePacket[3] & 0xc0) | 0x10 | continuityCounter;
            const length = Math.min(184, payload.length - offset);
            payload.copy(packet, 4, offset, offset + length);
            result.push(packet);
            offset += length;
            continuityCounter = (continuityCounter + 1) & 0x0f;
        }

        return result;
    }

    private collectPes(pid: number, payload: Buffer, payloadUnitStartIndicator: boolean, sourcePacket: Buffer): void {
        if (payloadUnitStartIndicator === true) {
            this.flushPes(pid);
            this.pesBuffers.set(pid, {
                chunks: [Buffer.from(payload)],
                length: payload.length,
                expected: AribSubtitleTimedMetadataTransform.LENGTH_UNKNOWN,
                sourcePacket: Buffer.from(sourcePacket),
            });
        } else {
            const assembling = this.pesBuffers.get(pid);
            if (typeof assembling === 'undefined') {
                return;
            }
            assembling.chunks.push(Buffer.from(payload));
            assembling.length += payload.length;
        }

        const assembling = this.pesBuffers.get(pid);
        if (typeof assembling === 'undefined') {
            return;
        }
        if (
            assembling.expected === AribSubtitleTimedMetadataTransform.LENGTH_UNKNOWN &&
            assembling.length >= AribSubtitleTimedMetadataTransform.PES_HEADER_SIZE
        ) {
            const head = Buffer.concat(assembling.chunks);
            const packetLength = (head[4] << 8) | head[5];
            assembling.expected =
                packetLength === 0 ? AribSubtitleTimedMetadataTransform.LENGTH_UNDEFINED : 6 + packetLength;
        }
        if (assembling.expected > 0 && assembling.length >= assembling.expected) {
            this.flushPes(pid, sourcePacket);
        }
    }

    private flushPes(pid: number, sourcePacket?: Buffer): void {
        const assembling = this.pesBuffers.get(pid);
        this.pesBuffers.delete(pid);
        if (typeof assembling === 'undefined' || assembling.length < 14) {
            return;
        }

        const merged = Buffer.concat(assembling.chunks);
        const pes = assembling.expected > 0 ? merged.subarray(0, assembling.expected) : merged;
        const metadata = this.parseSubtitlePes(pes);
        const packetForHeader = sourcePacket ?? assembling.sourcePacket;
        if (metadata === null || typeof packetForHeader === 'undefined') {
            return;
        }

        for (const pmtPid of this.subtitlePmtPids.keys()) {
            const subtitlePids = this.subtitlePmtPids.get(pmtPid);
            if (subtitlePids?.has(pid) !== true) {
                continue;
            }
            const metadataPid = this.metadataPidByPmt.get(pmtPid);
            if (typeof metadataPid === 'undefined') {
                continue;
            }
            for (const packet of this.packetizePes(
                metadataPid,
                this.buildTimedMetadataPes(metadata),
                packetForHeader,
            )) {
                this.push(packet);
            }
        }
    }

    private parseSubtitlePes(pes: Buffer): AribId3Metadata | null {
        if (pes.length < 14 || pes[0] !== 0x00 || pes[1] !== 0x00 || pes[2] !== 0x01 || pes[3] !== 0xbd) {
            return null;
        }
        if ((pes[7] & 0xc0) >> 6 !== 0x02 && (pes[7] & 0xc0) >> 6 !== 0x03) {
            return null;
        }

        const pts =
            ((pes[9] & 0x0e) / 2) * 0x40000000 +
            pes[10] * 0x400000 +
            ((pes[11] & 0xfe) / 2) * 0x8000 +
            pes[12] * 0x80 +
            (pes[13] & 0xfe) / 2;
        const headerDataLength = pes[8];
        const dataStart = 9 + headerDataLength;
        if (dataStart + 3 >= pes.length) {
            return null;
        }
        const dataPacketHeaderLength = pes[dataStart + 2] & 0x0f;
        const dataGroup = dataStart + 3 + dataPacketHeaderLength;
        const dataGroupId = dataGroup < pes.length ? (pes[dataGroup] & 0xfc) >> 2 : -1;
        if (this.isSubtitleDataGroupId(dataGroupId) === false) {
            return null;
        }

        return { pts, payload: this.buildId3Private('aribb24.js', pes.subarray(dataStart)) };
    }

    /**
     * ARIB 字幕の管理データと本文データの data_group_id を判定する
     * @param dataGroupId data_group_id (6 bit)
     * @return 字幕の data_group_id なら true
     */
    private isSubtitleDataGroupId(dataGroupId: number): boolean {
        return (dataGroupId >= 0x00 && dataGroupId <= 0x08) || (dataGroupId >= 0x20 && dataGroupId <= 0x28);
    }

    private buildId3Private(owner: string, binary: Buffer): Buffer {
        const privatePayload = Buffer.concat([Buffer.from(owner, 'utf8'), Buffer.from([0]), binary]);
        const frame = Buffer.concat([
            Buffer.from('PRIV', 'latin1'),
            this.syncSafe(privatePayload.length),
            Buffer.from([0, 0]),
            privatePayload,
        ]);
        return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0]), this.syncSafe(frame.length), frame]);
    }

    private buildTimedMetadataPes(metadata: AribId3Metadata): Buffer {
        const pts = metadata.pts;
        const ptsBytes = Buffer.from([
            0x21 | ((Math.floor(pts / 0x40000000) & 0x07) << 1),
            Math.floor(pts / 0x400000) & 0xff,
            ((Math.floor(pts / 0x8000) & 0x7f) << 1) | 1,
            Math.floor(pts / 0x80) & 0xff,
            ((pts & 0x7f) << 1) | 1,
        ]);
        const payload = Buffer.concat([Buffer.from([0x84, 0x80, 0x05]), ptsBytes, Buffer.alloc(5), metadata.payload]);
        const withoutPaddingLength = 6 + payload.length;
        const stuffingLength = 184 - (withoutPaddingLength % 184);
        const fullPayload = Buffer.concat([payload, Buffer.alloc(stuffingLength, 0xff)]);
        const result = Buffer.alloc(6 + fullPayload.length);
        result.set(Buffer.from([0, 0, 1, 0xbd]), 0);
        result.writeUInt16BE(fullPayload.length, 4);
        fullPayload.copy(result, 6);

        return result;
    }

    private packetizePes(pid: number, pes: Buffer, sourcePacket: Buffer): Buffer[] {
        const result: Buffer[] = [];
        let offset = 0;
        let continuityCounter = this.metadataContinuityCounters.get(pid) ?? 0;
        while (offset < pes.length) {
            const packet = Buffer.alloc(AribSubtitleTimedMetadataTransform.PACKET_SIZE, 0xff);
            const length = Math.min(184, pes.length - offset);
            packet[0] = AribSubtitleTimedMetadataTransform.SYNC_BYTE;
            packet[1] = (sourcePacket[1] & 0xa0) | (offset === 0 ? 0x40 : 0) | ((pid >> 8) & 0x1f);
            packet[2] = pid & 0xff;
            packet[3] = (sourcePacket[3] & 0xc0) | 0x10 | continuityCounter;
            pes.copy(packet, 4, offset, offset + length);
            result.push(packet);
            offset += length;
            continuityCounter = (continuityCounter + 1) & 0x0f;
        }
        this.metadataContinuityCounters.set(pid, continuityCounter);

        return result;
    }

    private syncSafe(value: number): Buffer {
        return Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
    }

    private static crc32(section: Buffer): number {
        let crc = 0xffffffff;
        for (const byte of section) {
            for (let bit = 7; bit >= 0; bit -= 1) {
                const inputBit = (byte >> bit) & 1;
                const topBit = (crc >>> 31) & 1;
                crc = (crc << 1) >>> 0;
                if ((topBit ^ inputBit) !== 0) {
                    crc = (crc ^ 0x04c11db7) >>> 0;
                }
            }
        }

        return crc >>> 0;
    }
}

namespace AribSubtitleTimedMetadataTransform {
    export interface AssembleBuffer {
        chunks: Buffer[];
        length: number;
        expected: number;
        sourcePacket?: Buffer;
    }

    export const PACKET_SIZE = 188;
    export const HEADER_SIZE = 4;
    export const SYNC_BYTE = 0x47;
    export const PAT_PID = 0x0000;
    export const STREAM_TYPE_PRIVATE_DATA = 0x06;
    export const STREAM_TYPE_METADATA = 0x15;
    export const PES_HEADER_SIZE = 6;
    export const LENGTH_UNKNOWN = -1;
    export const LENGTH_UNDEFINED = -2;
}

export default AribSubtitleTimedMetadataTransform;
