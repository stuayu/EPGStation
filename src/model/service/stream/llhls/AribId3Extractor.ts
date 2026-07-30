import * as stream from 'stream';
import ILogger from '../../../ILogger';
import IAribId3Extractor, { AribId3Metadata } from './IAribId3Extractor';

/**
 * AribId3Extractor
 * arib-subtitle-timedmetadater が付加した ID3 timed metadata PES を TS から抜き取り
 * 'id3' イベントとして通知する pass-through Transform
 * 入力された TS は加工せずそのまま下流 (エンコードプロセス) へ流す
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
class AribId3Extractor extends stream.Transform implements IAribId3Extractor {
    private log: ILogger | null;
    private buffer: Buffer = Buffer.alloc(0);
    private pmtPids: Set<number> = new Set();
    private metadataPids: Set<number> = new Set();
    private pesBuffers: Map<number, Buffer[]> = new Map();

    constructor(logger: ILogger | null = null) {
        super();
        this.log = logger;
    }

    public _transform(chunk: Buffer, _encoding: string, callback: stream.TransformCallback): void {
        try {
            this.parse(chunk);
        } catch (err: any) {
            this.log?.stream.warn(`[AribId3Extractor] TS 解析に失敗しました: ${err.message}`);
        }

        // 入力はそのまま下流へ流す
        callback(null, chunk);
    }

    public _flush(callback: stream.TransformCallback): void {
        try {
            for (const pid of this.pesBuffers.keys()) {
                this.flushPes(pid);
            }
        } catch (err: any) {
            this.log?.stream.warn(`[AribId3Extractor] TS 解析に失敗しました: ${err.message}`);
        }
        this.buffer = Buffer.alloc(0);
        callback();
    }

    /**
     * TS チャンクを解析する
     * @param chunk: Buffer
     */
    private parse(chunk: Buffer): void {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

        // 同期バイトを探す
        let offset = 0;
        while (offset + AribId3Extractor.PACKET_SIZE <= this.buffer.length) {
            if (this.buffer[offset] !== AribId3Extractor.SYNC_BYTE) {
                offset++;
                continue;
            }

            this.parsePacket(this.buffer.subarray(offset, offset + AribId3Extractor.PACKET_SIZE));
            offset += AribId3Extractor.PACKET_SIZE;
        }

        this.buffer = Buffer.from(this.buffer.subarray(offset));

        // 異常な入力でメモリを食い潰さないようにする
        if (this.buffer.length > AribId3Extractor.MAX_BUFFER_SIZE) {
            this.buffer = Buffer.alloc(0);
        }
    }

    /**
     * TS パケット 1 つを解析する
     * @param packet: Buffer 188 byte の TS パケット
     */
    private parsePacket(packet: Buffer): void {
        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        const adaptationFieldControl = (packet[3] & 0x30) >> 4;

        let payloadOffset = AribId3Extractor.HEADER_SIZE;
        if (adaptationFieldControl === 0x02 || adaptationFieldControl === 0x03) {
            payloadOffset += packet[AribId3Extractor.HEADER_SIZE] + 1;
        }
        if (adaptationFieldControl === 0x00 || adaptationFieldControl === 0x02) {
            return;
        }
        if (payloadOffset >= packet.length) {
            return;
        }

        const payload = packet.subarray(payloadOffset);

        if (pid === AribId3Extractor.PAT_PID) {
            const section = this.getSection(payload, payloadUnitStartIndicator);
            if (section !== null) {
                this.parsePat(section);
            }

            return;
        }

        if (this.pmtPids.has(pid) === true) {
            const section = this.getSection(payload, payloadUnitStartIndicator);
            if (section !== null) {
                this.parsePmt(section);
            }

            return;
        }

        if (this.metadataPids.has(pid) === true) {
            this.parseMetadataPes(pid, payload, payloadUnitStartIndicator);
        }
    }

    /**
     * payload から PSI セクションを取り出す
     * @param payload: Buffer
     * @param payloadUnitStartIndicator: boolean
     * @return Buffer | null
     */
    private getSection(payload: Buffer, payloadUnitStartIndicator: boolean): Buffer | null {
        if (payloadUnitStartIndicator === false) {
            // セクション分割には対応しない (PAT / PMT は 1 パケットに収まる前提)
            return null;
        }

        const pointerField = payload[0];
        const start = 1 + pointerField;
        if (start >= payload.length) {
            return null;
        }

        return payload.subarray(start);
    }

    /**
     * PAT を解析し PMT PID を記録する
     * @param section: Buffer
     */
    private parsePat(section: Buffer): void {
        if (section[0] !== 0x00) {
            return;
        }

        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = 3 + sectionLength - 4; // CRC32 を除く
        for (let i = AribId3Extractor.SECTION_HEADER_SIZE; i + 4 <= end; i += 4) {
            const programNumber = (section[i] << 8) | section[i + 1];
            if (programNumber === 0) {
                // network PID は対象外
                continue;
            }

            const pmtPid = ((section[i + 2] & 0x1f) << 8) | section[i + 3];
            this.pmtPids.add(pmtPid);
        }
    }

    /**
     * PMT を解析し ID3 timed metadata の PID を記録する
     * @param section: Buffer
     */
    private parsePmt(section: Buffer): void {
        if (section[0] !== 0x02) {
            return;
        }

        const sectionLength = ((section[1] & 0x0f) << 8) | section[2];
        const end = 3 + sectionLength - 4; // CRC32 を除く
        const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];

        let i = 12 + programInfoLength;
        while (i + 5 <= end) {
            const streamType = section[i];
            const elementaryPid = ((section[i + 1] & 0x1f) << 8) | section[i + 2];
            const esInfoLength = ((section[i + 3] & 0x0f) << 8) | section[i + 4];

            if (
                streamType === AribId3Extractor.STREAM_TYPE_METADATA &&
                this.metadataPids.has(elementaryPid) === false
            ) {
                this.metadataPids.add(elementaryPid);
                this.log?.stream.info(`[AribId3Extractor] ID3 timed metadata PID を検出しました: ${elementaryPid}`);
            }

            i += 5 + esInfoLength;
        }
    }

    /**
     * ID3 timed metadata の PES を組み立てる
     * @param pid: number
     * @param payload: Buffer
     * @param payloadUnitStartIndicator: boolean
     */
    private parseMetadataPes(pid: number, payload: Buffer, payloadUnitStartIndicator: boolean): void {
        if (payloadUnitStartIndicator === true) {
            // 前の PES を確定させる
            this.flushPes(pid);
            this.pesBuffers.set(pid, [Buffer.from(payload)]);

            return;
        }

        const buffers = this.pesBuffers.get(pid);
        if (buffers === undefined) {
            return;
        }

        buffers.push(Buffer.from(payload));
    }

    /**
     * 組み立て済みの PES から ID3 を取り出して 'id3' イベントを発行する
     * @param pid: number
     */
    private flushPes(pid: number): void {
        const buffers = this.pesBuffers.get(pid);
        this.pesBuffers.delete(pid);
        if (buffers === undefined || buffers.length === 0) {
            return;
        }

        const metadata = parsePes(Buffer.concat(buffers));
        if (metadata === null) {
            return;
        }

        this.emit('id3', metadata);
    }
}

/**
 * ID3 timed metadata の PES から PTS と ID3 タグ本体を取り出す
 * @param pes: Buffer
 * @return AribId3Metadata | null
 */
export const parsePes = (pes: Buffer): AribId3Metadata | null => {
    if (pes.length < 14) {
        return null;
    }

    // packet_start_code_prefix + stream_id
    if (
        pes[0] !== 0x00 ||
        pes[1] !== 0x00 ||
        pes[2] !== 0x01 ||
        pes[3] !== AribId3Extractor.STREAM_ID_PRIVATE_STREAM_1
    ) {
        return null;
    }

    const ptsDtsFlags = (pes[7] & 0xc0) >> 6;
    if (ptsDtsFlags !== 0x02 && ptsDtsFlags !== 0x03) {
        return null;
    }

    // 33 bit PTS (3 bit + 15 bit + 15 bit をマーカービットを挟んで格納している)
    // 32 bit を超えるためビット演算は使えない。各フィールドの重みは
    // 2^30 / 2^22 / 2^15 / 2^7 / 2^0
    const pts =
        ((pes[9] & 0x0e) / 2) * 0x40000000 +
        (pes[10] & 0xff) * 0x400000 +
        ((pes[11] & 0xfe) / 2) * 0x8000 +
        (pes[12] & 0xff) * 0x80 +
        (pes[13] & 0xfe) / 2;

    const headerDataLength = pes[8];
    let offset = 9 + headerDataLength;
    if (offset >= pes.length) {
        return null;
    }

    // arib-subtitle-timedmetadater は ffmpeg 向けに 5 byte の padding を挿入する
    if (
        isId3Header(pes, offset) === false &&
        isId3Header(pes, offset + AribId3Extractor.FFMPEG_METADATA_PADDING_SIZE) === true
    ) {
        offset += AribId3Extractor.FFMPEG_METADATA_PADDING_SIZE;
    }

    if (isId3Header(pes, offset) === false) {
        return null;
    }

    // ID3v2 の syncsafe size からタグ長を求める (header 10 byte + tagSize)
    const tagSize =
        ((pes[offset + 6] & 0x7f) << 21) |
        ((pes[offset + 7] & 0x7f) << 14) |
        ((pes[offset + 8] & 0x7f) << 7) |
        (pes[offset + 9] & 0x7f);
    const end = Math.min(offset + 10 + tagSize, pes.length);

    return {
        pts: pts,
        payload: Buffer.from(pes.subarray(offset, end)),
    };
};

/**
 * 指定位置が ID3v2 のヘッダか
 * @param buf: Buffer
 * @param offset: number
 * @return boolean
 */
const isId3Header = (buf: Buffer, offset: number): boolean => {
    if (offset + 10 > buf.length) {
        return false;
    }

    return buf[offset] === 0x49 && buf[offset + 1] === 0x44 && buf[offset + 2] === 0x33;
};

namespace AribId3Extractor {
    export const PACKET_SIZE = 188;
    export const HEADER_SIZE = 4;
    export const SYNC_BYTE = 0x47;
    export const PAT_PID = 0x0000;
    export const STREAM_TYPE_METADATA = 0x15;
    export const SECTION_HEADER_SIZE = 8;
    export const STREAM_ID_PRIVATE_STREAM_1 = 0xbd;
    export const MAX_BUFFER_SIZE = PACKET_SIZE * 1000;
    export const FFMPEG_METADATA_PADDING_SIZE = 5;
}

export default AribId3Extractor;
