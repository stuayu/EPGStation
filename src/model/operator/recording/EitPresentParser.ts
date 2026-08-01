/**
 * 現在放送中の番組 (EIT[p/f] present) 1 件分
 */
export interface EitPresentEvent {
    serviceId: number;
    eventId: number;
    // 放送開始時刻 (UNIX 時刻・ミリ秒)。未定 (0xFFFFFFFFFF) の場合は null
    startAt: number | null;
    // 番組長 (秒)。**放送時間未定 (ARIB の 0xFFFFFF) の場合は null** = 延長の可能性あり
    durationSec: number | null;
}

/**
 * 録画中の TS から EIT[p/f] present (PID 0x12 / table_id 0x4E / section 0) を取り出すパーサ。
 *
 * 「予約した番組が本当に始まったか」を録画側で判断するために使う。
 * 時刻指定予約 (Mirakurun のチャンネルストリーム) は予定時刻になった瞬間からデータが流れるため、
 * 前番組が延長していると前番組を録ってしまう。EIT[p/f] の present を読めば
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

    private remaining: Buffer = Buffer.alloc(0);
    private sectionBuffer: Buffer[] = [];
    private sectionSize = 0;
    private sectionLength = 0;

    /**
     * TS のチャンクを流し込み、解析できた present の番組情報を返す
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

            const event = this.readPacket(packet);
            if (event !== null) {
                result.push(event);
            }
        }

        buffer = buffer.subarray(offset);
        this.remaining = buffer.length > EitPresentParser.TS_PACKET_SIZE * 2 ? Buffer.alloc(0) : Buffer.from(buffer);

        return result;
    }

    /**
     * TS パケット 1 つを処理する
     * @param packet: Buffer 188 byte の TS パケット
     * @return EitPresentEvent | null セクションが完成した場合のみ返す
     */
    private readPacket(packet: Buffer): EitPresentEvent | null {
        if ((packet[1] & 0x80) !== 0) {
            // transport_error_indicator
            return null;
        }

        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid !== EitPresentParser.EIT_PID) {
            return null;
        }

        const adaptationFieldControl = (packet[3] & 0x30) >> 4;
        if (adaptationFieldControl === 0b00 || adaptationFieldControl === 0b10) {
            return null;
        }

        let payloadOffset = 4;
        if (adaptationFieldControl === 0b11) {
            payloadOffset += packet[4] + 1;
            if (payloadOffset >= EitPresentParser.TS_PACKET_SIZE) {
                return null;
            }
        }

        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        let payload = packet.subarray(payloadOffset);

        let completed: EitPresentEvent | null = null;
        if (payloadUnitStartIndicator === true) {
            const pointerField = payload[0];
            if (1 + pointerField > payload.length) {
                this.resetSection();

                return null;
            }

            if (pointerField > 0) {
                completed = this.appendSection(payload.subarray(1, 1 + pointerField));
            }
            this.resetSection();
            payload = payload.subarray(1 + pointerField);

            if (payload.length === 0 || payload[0] === 0xff) {
                return completed;
            }
        } else if (this.sectionBuffer.length === 0) {
            return null;
        }

        const appended = this.appendSection(payload);

        return appended === null ? completed : appended;
    }

    /**
     * 組み立て中のセクションにデータを追加し、完成したら解析する
     * @param data: Buffer
     * @return EitPresentEvent | null
     */
    private appendSection(data: Buffer): EitPresentEvent | null {
        if (data.length === 0) {
            return null;
        }

        this.sectionBuffer.push(Buffer.from(data));
        this.sectionSize += data.length;

        if (this.sectionLength === 0) {
            if (this.sectionSize < 3) {
                return null;
            }

            const head = Buffer.concat(this.sectionBuffer, this.sectionSize);
            if (head[0] !== EitPresentParser.TABLE_ID_EIT_PF_ACTUAL) {
                this.resetSection();

                return null;
            }

            this.sectionLength = (((head[1] & 0x0f) << 8) | head[2]) + 3;
            if (this.sectionLength > EitPresentParser.MAX_SECTION_SIZE) {
                this.resetSection();

                return null;
            }
        }

        if (this.sectionSize < this.sectionLength) {
            return null;
        }

        const section = Buffer.concat(this.sectionBuffer, this.sectionSize).subarray(0, this.sectionLength);
        this.resetSection();

        return EitPresentParser.parseSection(section);
    }

    private resetSection(): void {
        this.sectionBuffer = [];
        this.sectionSize = 0;
        this.sectionLength = 0;
    }

    /**
     * EIT セクションから present の番組を取り出す
     * @param section: Buffer
     * @return EitPresentEvent | null present (section_number 0) 以外は null
     */
    private static parseSection(section: Buffer): EitPresentEvent | null {
        // table_id(1) section_length(2) service_id(2) version(1) section_number(1)
        // last_section_number(1) transport_stream_id(2) original_network_id(2)
        // segment_last_section_number(1) last_table_id(1) = 14 byte
        if (section.length < 14 + 12) {
            return null;
        }

        const sectionNumber = section[6];
        if (sectionNumber !== 0) {
            // section 0 = present (1 = following)
            return null;
        }

        const serviceId = section.readUInt16BE(3);
        const event = section.subarray(14);
        const eventId = event.readUInt16BE(0);
        const startAt = EitPresentParser.decodeJstDate(event.subarray(2, 7));
        const duration = (event[7] << 16) | (event[8] << 8) | event[9];

        return {
            serviceId: serviceId,
            eventId: eventId,
            startAt: startAt,
            durationSec:
                duration === EitPresentParser.UNDEFINED_DURATION ? null : EitPresentParser.decodeBcdDuration(event, 7),
        };
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
        const hour = (bytes[2] >> 4) * 10 + (bytes[2] & 0x0f);
        const minute = (bytes[3] >> 4) * 10 + (bytes[3] & 0x0f);
        const second = (bytes[4] >> 4) * 10 + (bytes[4] & 0x0f);

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
    private static decodeBcdDuration(bytes: Buffer, offset: number): number {
        const hour = (bytes[offset] >> 4) * 10 + (bytes[offset] & 0x0f);
        const minute = (bytes[offset + 1] >> 4) * 10 + (bytes[offset + 1] & 0x0f);
        const second = (bytes[offset + 2] >> 4) * 10 + (bytes[offset + 2] & 0x0f);

        return hour * 3600 + minute * 60 + second;
    }
}
