import * as stream from 'stream';
import ILogger from '../../../ILogger';
import IBroadcastTimeExtractor, { BroadcastTime } from './IBroadcastTimeExtractor';

/**
 * BroadcastTimeExtractor
 *
 * TS の TDT / TOT (PID 0x14) を読み取り、いま配信している映像の放送時刻を保持する
 * pass-through Transform。入力された TS は加工せずそのまま下流へ流す。
 *
 * ライブ視聴ではチューナー → サーバ → エンコード → 配信 → 再生の間に遅延があり、
 * ニコニコ実況のコメントは「実時間」で届くため、補正しないとコメントが映像より先行する。
 * ここで得た放送時刻と受信時刻の差がサーバ側の遅延にあたる。
 *
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
export default class BroadcastTimeExtractor extends stream.Transform implements IBroadcastTimeExtractor {
    private static readonly PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
    private static readonly HEADER_SIZE = 4;
    // TDT / TOT が流れる PID
    private static readonly TDT_PID = 0x14;
    private static readonly TABLE_ID_TDT = 0x70;
    private static readonly TABLE_ID_TOT = 0x73;
    private static readonly JST_OFFSET_MS = 9 * 60 * 60 * 1000;
    // 同期バイトを見失った場合に備えた入力バッファの上限
    private static readonly MAX_BUFFER_SIZE = BroadcastTimeExtractor.PACKET_SIZE * 1000;

    private log: ILogger | null;
    private buffer: Buffer = Buffer.alloc(0);
    private broadcastTime: BroadcastTime | null = null;

    constructor(logger: ILogger | null = null) {
        super();
        this.log = logger;
    }

    public _transform(chunk: Buffer, _encoding: string, callback: stream.TransformCallback): void {
        try {
            this.parse(chunk);
        } catch (err: any) {
            this.log?.stream.warn(`[BroadcastTimeExtractor] TS 解析に失敗しました: ${err.message}`);
        }

        // 入力はそのまま下流へ流す
        callback(null, chunk);
    }

    public _flush(callback: stream.TransformCallback): void {
        this.buffer = Buffer.alloc(0);
        callback();
    }

    /**
     * 最後に読み取った放送時刻を返す
     * @return BroadcastTime | null まだ TDT / TOT を受信していない場合は null
     */
    public getBroadcastTime(): BroadcastTime | null {
        return this.broadcastTime;
    }

    /**
     * TS チャンクを解析する
     * @param chunk: Buffer
     */
    private parse(chunk: Buffer): void {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

        let offset = 0;
        while (offset + BroadcastTimeExtractor.PACKET_SIZE <= this.buffer.length) {
            if (this.buffer[offset] !== BroadcastTimeExtractor.SYNC_BYTE) {
                offset++;
                continue;
            }

            this.parsePacket(this.buffer.subarray(offset, offset + BroadcastTimeExtractor.PACKET_SIZE));
            offset += BroadcastTimeExtractor.PACKET_SIZE;
        }

        this.buffer = Buffer.from(this.buffer.subarray(offset));

        // 異常な入力でメモリを食い潰さないようにする
        if (this.buffer.length > BroadcastTimeExtractor.MAX_BUFFER_SIZE) {
            this.buffer = Buffer.alloc(0);
        }
    }

    /**
     * TS パケット 1 つを解析する
     * TDT / TOT は 1 パケットに収まるため、分割セクションの組み立ては行わない
     * @param packet: Buffer 188 byte の TS パケット
     */
    private parsePacket(packet: Buffer): void {
        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid !== BroadcastTimeExtractor.TDT_PID) {
            return;
        }

        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        if (payloadUnitStartIndicator === false) {
            return;
        }

        const adaptationFieldControl = (packet[3] & 0x30) >> 4;
        if (adaptationFieldControl === 0x00 || adaptationFieldControl === 0x02) {
            return;
        }

        let payloadOffset = BroadcastTimeExtractor.HEADER_SIZE;
        if (adaptationFieldControl === 0x03) {
            payloadOffset += packet[BroadcastTimeExtractor.HEADER_SIZE] + 1;
        }
        if (payloadOffset >= packet.length) {
            return;
        }

        // payload_unit_start_indicator が立っているので先頭に pointer_field がある
        const pointerField = packet[payloadOffset];
        const sectionOffset = payloadOffset + 1 + pointerField;
        // table_id(1) + section header(2) + JST_time(5)
        if (sectionOffset + 8 > packet.length) {
            return;
        }

        const tableId = packet[sectionOffset];
        if (tableId !== BroadcastTimeExtractor.TABLE_ID_TDT && tableId !== BroadcastTimeExtractor.TABLE_ID_TOT) {
            return;
        }

        const time = BroadcastTimeExtractor.decodeJstTime(packet.subarray(sectionOffset + 3, sectionOffset + 8));
        if (time === null) {
            return;
        }

        this.broadcastTime = { time: time, receivedAt: new Date().getTime() };
    }

    /**
     * MJD + BCD (5 byte) の日時を UNIX 時刻 (ミリ秒) にする
     * TS 上の時刻は日本標準時なので、サーバのタイムゾーンに関係なく JST として解釈する
     * @param buffer: Buffer JST_time (5 byte)
     * @return number | null 解釈できない場合は null
     */
    private static decodeJstTime(buffer: Buffer): number | null {
        if (buffer.length < 5) {
            return null;
        }
        if (buffer[0] === 0xff && buffer[1] === 0xff) {
            return null;
        }

        const mjd = (buffer[0] << 8) | buffer[1];
        let year = ((mjd - 15078.2) / 365.25) | 0;
        let month = ((mjd - 14956.1 - ((year * 365.25) | 0)) / 30.6001) | 0;
        const day = mjd - 14956 - ((year * 365.25) | 0) - ((month * 30.6001) | 0);
        const k = month === 14 || month === 15 ? 1 : 0;
        year = year + k + 1900;
        month = month - 1 - k * 12;

        const hour = (buffer[2] >> 4) * 10 + (buffer[2] & 0x0f);
        const minute = (buffer[3] >> 4) * 10 + (buffer[3] & 0x0f);
        const second = (buffer[4] >> 4) * 10 + (buffer[4] & 0x0f);

        if (hour > 23 || minute > 59 || second > 60) {
            return null;
        }

        return Date.UTC(year, month - 1, day, hour, minute, second) - BroadcastTimeExtractor.JST_OFFSET_MS;
    }
}
