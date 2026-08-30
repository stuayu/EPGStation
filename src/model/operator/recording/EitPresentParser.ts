import * as aribts from 'aribts';

/**
 * EIT[p/f] の present または following 1 件分
 */
export interface EitPresentEvent {
    serviceId: number;
    eventId: number;
    // 放送開始時刻 (UNIX 時刻・ミリ秒)。未定 (0xFFFFFFFFFF) の場合は null
    startAt: number | null;
    // 番組長 (秒)。**放送時間未定 (ARIB の 0xFFFFFF) の場合は null** = 延長の可能性あり
    durationSec: number | null;
    // EIT event の running_status (0=undefined, 1=not running, 2=starts soon,
    // 3=pausing, 4=running)。
    runningStatus: number;
    // EIT section 内の時系列で 2 件目が following。
    isFollowing: boolean;
    transportStreamId: number;
    originalNetworkId: number;
}

export interface EitPresentParserOptions {
    serviceId?: number;
    transportStreamId?: number;
    originalNetworkId?: number;
}

/**
 * 録画中の TS から EIT[p/f] (PID 0x12 / table_id 0x4E) を取り出すパーサ。
 *
 * 「予約した番組が本当に始まったか」を録画側で判断するために使う。
 * 時刻指定予約 (Mirakurun のチャンネルストリーム) は予定時刻になった瞬間からデータが流れるため、
 * 前番組が延長していると前番組を録ってしまう。EIT[p/f] の present/following を読めば
 * 「いま流れているのが何の番組か」「その番組の放送時間が未定 (= 延長しうる) か」が分かる。
 *
 * aribts の TsSectionParser はストリーム全体を扱うため録画経路に挟むには重い。
 * ここでは BitParser と同じ方式で TS パケットの分解とセクション組み立てだけを自前で行う。
 * 状態を持つため録画ごとにインスタンスを生成する (DI 対象ではない)。
 */
export default class EitPresentParser {
    private static readonly TS_PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
    private static readonly EIT_PID = 0x0012;
    // EIT[p/f] actual (自ストリーム)
    private static readonly TABLE_ID_EIT_PF_ACTUAL = 0x4e;
    private static readonly MAX_SECTION_SIZE = 4096;
    // 放送時間未定を表す値
    private static readonly UNDEFINED_DURATION = 0xffffff;

    private options: EitPresentParserOptions;

    private remaining: Buffer = Buffer.alloc(0);
    private sectionBuffer: Buffer = Buffer.alloc(0);
    private sectionLength = 0;

    public constructor(options: EitPresentParserOptions = {}) {
        this.options = options;
    }

    /**
     * TS のチャンクを流し込み、解析できた present / following の番組情報を返す
     * @param chunk: Buffer TS データ (188 byte 境界でなくてもよい)
     * @return EitPresentEvent[] このチャンクで解析できたもの
     */
    public write(chunk: Buffer): EitPresentEvent[] {
        const result: EitPresentEvent[] = [];
        let buffer = this.remaining.length === 0 ? chunk : Buffer.concat([this.remaining, chunk]);

        let offset = 0;
        while (offset + EitPresentParser.TS_PACKET_SIZE <= buffer.length) {
            if (buffer[offset] !== EitPresentParser.SYNC_BYTE) {
                const syncIndex = buffer.indexOf(EitPresentParser.SYNC_BYTE, offset + 1);
                if (syncIndex === -1) {
                    offset = buffer.length;
                    break;
                }
                offset = syncIndex;
                continue;
            }

            const packet = buffer.subarray(offset, offset + EitPresentParser.TS_PACKET_SIZE);
            offset += EitPresentParser.TS_PACKET_SIZE;

            result.push(...this.readPacket(packet));
        }

        buffer = buffer.subarray(offset);
        this.remaining = buffer.length > EitPresentParser.TS_PACKET_SIZE * 2 ? Buffer.alloc(0) : Buffer.from(buffer);

        return result;
    }

    /**
     * TS パケット 1 つを処理する
     * @param packet: Buffer 188 byte の TS パケット
     * @return EitPresentEvent[] この packet で完成した present / following
     */
    private readPacket(packet: Buffer): EitPresentEvent[] {
        if ((packet[1] & 0x80) !== 0) {
            // transport_error_indicator
            return [];
        }

        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid !== EitPresentParser.EIT_PID) {
            return [];
        }

        const adaptationFieldControl = (packet[3] & 0x30) >> 4;
        if (adaptationFieldControl === 0b00 || adaptationFieldControl === 0b10) {
            return [];
        }

        let payloadOffset = 4;
        if (adaptationFieldControl === 0b11) {
            payloadOffset += packet[4] + 1;
            if (payloadOffset >= EitPresentParser.TS_PACKET_SIZE) {
                return [];
            }
        }

        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        let payload = packet.subarray(payloadOffset);

        const completed: EitPresentEvent[] = [];
        if (payloadUnitStartIndicator === true) {
            const pointerField = payload[0];
            if (1 + pointerField > payload.length) {
                this.resetSection();

                return [];
            }

            if (pointerField > 0) {
                completed.push(...this.appendSection(payload.subarray(1, 1 + pointerField)));
            }
            // pointer_field より後は新しい section の先頭。前 section が未完なら破棄する
            this.resetSection();
            payload = payload.subarray(1 + pointerField);

            if (payload.length === 0 || payload[0] === 0xff) {
                return completed;
            }
        } else if (this.sectionBuffer.length === 0) {
            return [];
        }

        completed.push(...this.appendSection(payload));

        return completed;
    }

    /**
     * 組み立て中のセクションにデータを追加し、完成したら解析する
     * @param data: Buffer
     * @return EitPresentEvent[]
     */
    private appendSection(data: Buffer): EitPresentEvent[] {
        const result: EitPresentEvent[] = [];
        if (data.length === 0) {
            return result;
        }

        let offset = 0;
        while (offset < data.length) {
            if (this.sectionBuffer.length === 0 && data[offset] === 0xff) break;

            if (this.sectionLength === 0) {
                const neededForHeader = 3 - this.sectionBuffer.length;
                const take = Math.min(neededForHeader, data.length - offset);
                this.sectionBuffer = Buffer.concat([this.sectionBuffer, data.subarray(offset, offset + take)]);
                offset += take;
                if (this.sectionBuffer.length < 3) break;

                this.sectionLength = (((this.sectionBuffer[1] & 0x0f) << 8) | this.sectionBuffer[2]) + 3;
                if (this.sectionLength < 3 || this.sectionLength > EitPresentParser.MAX_SECTION_SIZE) {
                    this.resetSection();
                    break;
                }
            }

            const needed = this.sectionLength - this.sectionBuffer.length;
            const take = Math.min(needed, data.length - offset);
            this.sectionBuffer = Buffer.concat([this.sectionBuffer, data.subarray(offset, offset + take)]);
            offset += take;
            if (this.sectionBuffer.length < this.sectionLength) break;

            const section = this.sectionBuffer;
            this.resetSection();
            if (section[0] !== EitPresentParser.TABLE_ID_EIT_PF_ACTUAL) continue;
            result.push(...EitPresentParser.parseSection(section, this.options));
        }
        return result;
    }

    private resetSection(): void {
        this.sectionBuffer = Buffer.alloc(0);
        this.sectionLength = 0;
    }

    /**
     * EIT セクションから時系列順の present / following を取り出す
     * @param section: Buffer
     * @return EitPresentEvent[] section 内の present / following
     */
    private static parseSection(section: Buffer, options: EitPresentParserOptions): EitPresentEvent[] {
        // table_id(1) section_length(2) service_id(2) version(1) section_number(1)
        // last_section_number(1) transport_stream_id(2) original_network_id(2)
        // segment_last_section_number(1) last_table_id(1) = 14 byte
        if (section.length < 14 + 12 + 4) {
            return [];
        }

        // EIT の section は current_next_indicator=1 の現行情報だけを採用し、
        // CRC-32 が正しいものだけを録画開始判定へ渡す。
        if ((section[1] & 0x80) === 0 || (section[5] & 0x01) === 0 || aribts.TsCrc32.calc(section) !== 0) {
            return [];
        }

        const serviceId = section.readUInt16BE(3);
        const transportStreamId = section.readUInt16BE(8);
        const originalNetworkId = section.readUInt16BE(10);
        if (
            (options.serviceId !== undefined && options.serviceId !== serviceId) ||
            (options.transportStreamId !== undefined && options.transportStreamId !== transportStreamId) ||
            (options.originalNetworkId !== undefined && options.originalNetworkId !== originalNetworkId)
        ) {
            return [];
        }

        // EIT[p/f] は present を section_number = 0、following を section_number = 1 で送る
        // (1 セクションに 1 イベント)。NVOD 参照サービスだけは 1 セクションに複数イベントが載るため、
        // その場合に限り section 内の 2 件目以降を following として扱う
        const sectionNumber = section[6];
        if (sectionNumber > 1) {
            return [];
        }

        const result: EitPresentEvent[] = [];
        const eventEnd = section.length - 4;
        let offset = 14;
        let eventIndex = 0;
        while (offset < eventEnd) {
            if (offset + 12 > eventEnd) return [];
            const eventId = section.readUInt16BE(offset);
            const startAt = EitPresentParser.decodeJstDate(section.subarray(offset + 2, offset + 7));
            const duration = (section[offset + 7] << 16) | (section[offset + 8] << 8) | section[offset + 9];
            const runningStatus = section[offset + 10] >> 5;
            const descriptorsLength = ((section[offset + 10] & 0x0f) << 8) | section[offset + 11];
            offset += 12;
            if (offset + descriptorsLength > eventEnd || runningStatus > 4) return [];
            const durationSec =
                duration === EitPresentParser.UNDEFINED_DURATION
                    ? null
                    : EitPresentParser.decodeBcdDuration(section, offset - 5);
            if (durationSec === undefined) return [];
            if (eventIndex < 2) {
                result.push({
                    serviceId,
                    eventId,
                    startAt,
                    durationSec,
                    runningStatus,
                    isFollowing: sectionNumber === 1 || eventIndex === 1,
                    transportStreamId,
                    originalNetworkId,
                });
            }
            eventIndex++;
            offset += descriptorsLength;
        }
        return result;
    }

    /**
     * MJD + BCD の日時を UNIX 時刻 (ミリ秒) に変換する
     * @param bytes: Buffer 5 byte
     * @return number | null 未定 (全 0xFF) の場合は null
     */
    private static decodeJstDate(bytes: Buffer): number | null {
        if (bytes.length < 5) {
            return null;
        }
        if (bytes[0] === 0xff && bytes[1] === 0xff && bytes[2] === 0xff && bytes[3] === 0xff && bytes[4] === 0xff) {
            return null;
        }

        const mjd = (bytes[0] << 8) | bytes[1];
        const hour = EitPresentParser.decodeBcd(bytes[2]);
        const minute = EitPresentParser.decodeBcd(bytes[3]);
        const second = EitPresentParser.decodeBcd(bytes[4]);
        if (
            hour === undefined ||
            minute === undefined ||
            second === undefined ||
            hour > 23 ||
            minute > 59 ||
            second > 59
        ) {
            return null;
        }

        // MJD の起点 (1858-11-17) からの日数を UNIX 時刻へ。時刻は JST なので UTC へ戻す
        const days = mjd - 40587;
        const jstMs = days * 86400000 + (hour * 3600 + minute * 60 + second) * 1000;

        return jstMs - 9 * 60 * 60 * 1000;
    }

    /**
     * BCD の番組長を秒に変換する
     * @param bytes: Buffer
     * @param offset: number
     * @return number
     */
    private static decodeBcdDuration(bytes: Buffer, offset: number): number | undefined {
        const hour = EitPresentParser.decodeBcd(bytes[offset]);
        const minute = EitPresentParser.decodeBcd(bytes[offset + 1]);
        const second = EitPresentParser.decodeBcd(bytes[offset + 2]);
        if (hour === undefined || minute === undefined || second === undefined || minute > 59 || second > 59) {
            return undefined;
        }

        return hour * 3600 + minute * 60 + second;
    }

    private static decodeBcd(value: number): number | undefined {
        const high = value >> 4;
        const low = value & 0x0f;
        return high <= 9 && low <= 9 ? high * 10 + low : undefined;
    }
}
