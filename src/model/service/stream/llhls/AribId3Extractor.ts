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
    // 組み立て中の PSI セクション (PMT は複数 TS パケットに分割されることがある)
    private sectionBuffers: Map<number, AribId3Extractor.AssembleBuffer> = new Map();
    // 組み立て中の ID3 timed metadata PES
    private pesBuffers: Map<number, AribId3Extractor.AssembleBuffer> = new Map();

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
            const section = this.getSection(pid, payload, payloadUnitStartIndicator);
            if (section !== null) {
                this.parsePat(section);
            }

            return;
        }

        if (this.pmtPids.has(pid) === true) {
            const section = this.getSection(pid, payload, payloadUnitStartIndicator);
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
     * payload から PSI セクションを取り出す。
     * arib-subtitle-timedmetadater は PMT に metadata 用の記述子と ES を書き足すため、
     * 元の PMT が大きい放送局では 1 TS パケット (184 byte) に収まらず分割される。
     * 先頭パケットだけを見ていると metadata の PID を検出できず、字幕が 1 つも出なくなる
     * @param pid: number
     * @param payload: Buffer
     * @param payloadUnitStartIndicator: boolean
     * @return Buffer | null 完成したセクション。組み立て中は null
     */
    private getSection(pid: number, payload: Buffer, payloadUnitStartIndicator: boolean): Buffer | null {
        if (payloadUnitStartIndicator === true) {
            const pointerField = payload[0];
            const start = 1 + pointerField;
            if (start >= payload.length) {
                this.sectionBuffers.delete(pid);

                return null;
            }

            this.sectionBuffers.set(pid, {
                chunks: [Buffer.from(payload.subarray(start))],
                length: payload.length - start,
                expected: AribId3Extractor.LENGTH_UNKNOWN,
            });
        } else {
            const assembling = this.sectionBuffers.get(pid);
            if (typeof assembling === 'undefined') {
                // セクションの途中から受信した場合は次の先頭まで待つ
                return null;
            }
            assembling.chunks.push(Buffer.from(payload));
            assembling.length += payload.length;
        }

        const entry = this.sectionBuffers.get(pid) as AribId3Extractor.AssembleBuffer;

        // section_length はセクション先頭 3 byte で決まる
        if (entry.expected === AribId3Extractor.LENGTH_UNKNOWN && entry.length >= 3) {
            const head = AribId3Extractor.mergeChunks(entry);
            entry.expected = AribId3Extractor.SECTION_LENGTH_OFFSET + (((head[1] & 0x0f) << 8) | head[2]);
        }

        if (entry.expected < 0 || entry.length < entry.expected) {
            return null;
        }

        this.sectionBuffers.delete(pid);

        return AribId3Extractor.mergeChunks(entry).subarray(0, entry.expected);
    }

    /**
     * 組み立て中のバッファを 1 つの Buffer にまとめる (以後の結合を避けるため詰め直す)
     * @param entry: AribId3Extractor.AssembleBuffer
     * @return Buffer
     */
    private static mergeChunks(entry: AribId3Extractor.AssembleBuffer): Buffer {
        if (entry.chunks.length > 1) {
            entry.chunks = [Buffer.concat(entry.chunks)];
        }

        return entry.chunks[0];
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
            // 前の PES が長さ不定のまま残っていた場合はここで確定させる
            this.flushPes(pid);
            this.pesBuffers.set(pid, {
                chunks: [Buffer.from(payload)],
                length: payload.length,
                expected: AribId3Extractor.LENGTH_UNKNOWN,
            });
        } else {
            const assembling = this.pesBuffers.get(pid);
            if (typeof assembling === 'undefined') {
                return;
            }
            assembling.chunks.push(Buffer.from(payload));
            assembling.length += payload.length;
        }

        const entry = this.pesBuffers.get(pid) as AribId3Extractor.AssembleBuffer;

        // PES_packet_length が判れば、そこまで揃った時点で確定できる。
        // 次の字幕が来るまで待つと表示が 1 つ遅れる (字幕の間隔は数秒〜数十秒あるため実質出ない)
        if (entry.expected === AribId3Extractor.LENGTH_UNKNOWN && entry.length >= AribId3Extractor.PES_HEADER_SIZE) {
            const head = AribId3Extractor.mergeChunks(entry);
            const packetLength = (head[4] << 8) | head[5];
            // 0 は長さ不定 (映像 PES 等)。その場合は次の PES 開始まで待つ
            entry.expected =
                packetLength === 0
                    ? AribId3Extractor.LENGTH_UNDEFINED
                    : AribId3Extractor.PES_HEADER_SIZE + packetLength;
        }

        if (entry.expected > 0 && entry.length >= entry.expected) {
            this.flushPes(pid);
        }
    }

    /**
     * 組み立て済みの PES から ID3 を取り出して 'id3' イベントを発行する
     * @param pid: number
     */
    private flushPes(pid: number): void {
        const entry = this.pesBuffers.get(pid);
        this.pesBuffers.delete(pid);
        if (typeof entry === 'undefined' || entry.length === 0) {
            return;
        }

        const merged = AribId3Extractor.mergeChunks(entry);
        const metadata = parsePes(entry.expected > 0 ? merged.subarray(0, entry.expected) : merged);
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
    /**
     * 組み立て中の PSI セクション / PES
     */
    export interface AssembleBuffer {
        chunks: Buffer[];
        // chunks の合計バイト数
        length: number;
        // 完成に必要なバイト数。LENGTH_UNKNOWN = 未判定、LENGTH_UNDEFINED = 長さ不定
        expected: number;
    }

    export const LENGTH_UNKNOWN = -1;
    export const LENGTH_UNDEFINED = -2;
    export const PACKET_SIZE = 188;
    export const HEADER_SIZE = 4;
    export const SYNC_BYTE = 0x47;
    export const PAT_PID = 0x0000;
    export const STREAM_TYPE_METADATA = 0x15;
    export const SECTION_HEADER_SIZE = 8;
    // section_length は table_id(1) + section_length を含む 2 byte の後ろから数える
    export const SECTION_LENGTH_OFFSET = 3;
    export const PES_HEADER_SIZE = 6;
    export const STREAM_ID_PRIVATE_STREAM_1 = 0xbd;
    export const MAX_BUFFER_SIZE = PACKET_SIZE * 1000;
    export const FFMPEG_METADATA_PADDING_SIZE = 5;
}

export default AribId3Extractor;
