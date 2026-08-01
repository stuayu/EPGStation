import * as aribts from 'aribts';

/**
 * BIT (Broadcaster Information Table) から取り出した放送事業者 1 件分の情報
 */
export interface BitBroadcaster {
    broadcasterId: number; // 放送事業者識別
    terrestrialBroadcasterId: number | null; // 地上放送事業者識別 (extended_broadcaster_descriptor)
    affiliationIds: number[]; // 系列識別
    networkIds: number[]; // この事業者が送出する original_network_id 一覧
}

/**
 * BIT セクション 1 つ分の解析結果
 */
export interface BitSectionInfo {
    originalNetworkId: number; // このセクションを送出しているネットワーク
    broadcasters: BitBroadcaster[];
}

/**
 * TS ストリームから BIT (PID 0x0024 / table_id 0xC4) を取り出して
 * 系列識別 (affiliation_id) を得るパーサ
 *
 * aribts の TsSectionParser は BIT に対応していないため、
 * TS パケットの分解とセクションの組み立てのみ自前で行い、
 * 記述子の解析は aribts の TsDescriptors に任せる。
 *
 * 状態を持つため、配信・解析ごとにインスタンスを生成して使う (DI 対象ではない)。
 */
export default class BitParser {
    private static readonly TS_PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
    private static readonly BIT_PID = 0x0024;
    private static readonly BIT_TABLE_ID = 0xc4;
    private static readonly DESCRIPTOR_TAG_EXTENDED_BROADCASTER = 0xce;

    // extended_broadcaster_descriptor の broadcaster_type (1 = 地上デジタルテレビジョン放送)
    private static readonly BROADCASTER_TYPE_TERRESTRIAL = 1;

    // セクションが壊れている場合に無制限にバッファへ溜め込まないための上限
    private static readonly MAX_SECTION_SIZE = 4096;

    // TS パケット境界に満たない端数
    private remaining: Buffer = Buffer.alloc(0);

    // 組み立て中のセクション
    private sectionBuffer: Buffer[] = [];
    private sectionSize = 0;
    private sectionLength = 0;

    /**
     * TS のチャンクを流し込み、解析できた BIT セクションを返す
     * @param chunk: Buffer TS データ (188 byte 境界でなくてもよい)
     * @return BitSectionInfo[] このチャンクで解析できたセクション
     */
    public write(chunk: Buffer): BitSectionInfo[] {
        const result: BitSectionInfo[] = [];
        let buffer = this.remaining.length === 0 ? chunk : Buffer.concat([this.remaining, chunk]);

        let offset = 0;
        while (offset + BitParser.TS_PACKET_SIZE <= buffer.length) {
            if (buffer[offset] !== BitParser.SYNC_BYTE) {
                // 同期がずれているので次の同期バイトを探す
                const syncIndex = buffer.indexOf(BitParser.SYNC_BYTE, offset + 1);
                if (syncIndex === -1) {
                    offset = buffer.length;
                    break;
                }
                offset = syncIndex;
                continue;
            }

            const packet = buffer.subarray(offset, offset + BitParser.TS_PACKET_SIZE);
            offset += BitParser.TS_PACKET_SIZE;

            const section = this.readPacket(packet);
            if (section !== null) {
                result.push(section);
            }
        }

        // 端数を次回に持ち越す (同期バイト探索で溢れないように上限を設ける)
        buffer = buffer.subarray(offset);
        this.remaining = buffer.length > BitParser.TS_PACKET_SIZE * 2 ? Buffer.alloc(0) : Buffer.from(buffer);

        return result;
    }

    /**
     * TS パケット 1 つを処理する
     * @param packet: Buffer 188 byte の TS パケット
     * @return BitSectionInfo | null セクションが完成した場合のみ返す
     */
    private readPacket(packet: Buffer): BitSectionInfo | null {
        // transport_error_indicator
        if ((packet[1] & 0x80) !== 0) {
            return null;
        }

        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid !== BitParser.BIT_PID) {
            return null;
        }

        const adaptationFieldControl = (packet[3] & 0x30) >> 4;
        if (adaptationFieldControl === 0b00 || adaptationFieldControl === 0b10) {
            // payload なし
            return null;
        }

        let payloadOffset = 4;
        if (adaptationFieldControl === 0b11) {
            payloadOffset += packet[4] + 1;
            if (payloadOffset >= BitParser.TS_PACKET_SIZE) {
                return null;
            }
        }

        const payloadUnitStartIndicator = (packet[1] & 0x40) !== 0;
        let payload = packet.subarray(payloadOffset);

        let completed: BitSectionInfo | null = null;
        if (payloadUnitStartIndicator === true) {
            const pointerField = payload[0];
            if (1 + pointerField > payload.length) {
                this.resetSection();

                return null;
            }

            // pointer_field の分は組み立て中セクションの続き
            if (pointerField > 0) {
                completed = this.appendSection(payload.subarray(1, 1 + pointerField));
            }
            this.resetSection();
            payload = payload.subarray(1 + pointerField);

            if (payload.length === 0 || payload[0] === 0xff) {
                // スタッフィングのみ
                return completed;
            }
        } else if (this.sectionBuffer.length === 0) {
            // セクションの先頭を受け取っていない
            return null;
        }

        const appended = this.appendSection(payload);

        return appended === null ? completed : appended;
    }

    /**
     * 組み立て中のセクションにデータを追加し、完成したら解析する
     * @param data: Buffer
     * @return BitSectionInfo | null
     */
    private appendSection(data: Buffer): BitSectionInfo | null {
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
            if (head[0] !== BitParser.BIT_TABLE_ID) {
                this.resetSection();

                return null;
            }

            // section_length + table_id(1) + section_length を含む 2 byte
            this.sectionLength = (((head[1] & 0x0f) << 8) | head[2]) + 3;
            if (this.sectionLength > BitParser.MAX_SECTION_SIZE) {
                this.resetSection();

                return null;
            }
        }

        if (this.sectionSize < this.sectionLength) {
            return null;
        }

        const section = Buffer.concat(this.sectionBuffer, this.sectionSize).subarray(0, this.sectionLength);
        this.resetSection();

        return BitParser.parseSection(section);
    }

    /**
     * 組み立て中のセクションを破棄する
     */
    private resetSection(): void {
        this.sectionBuffer = [];
        this.sectionSize = 0;
        this.sectionLength = 0;
    }

    /**
     * BIT セクションを解析する
     * @param section: Buffer CRC_32 を含むセクション全体
     * @return BitSectionInfo | null 解析できなかった場合は null
     */
    private static parseSection(section: Buffer): BitSectionInfo | null {
        if (section.length < 12 || section[0] !== BitParser.BIT_TABLE_ID) {
            return null;
        }

        // CRC_32 (末尾 4 byte を含めた全体の CRC が 0 になる)
        if (aribts.TsCrc32.calc(section) !== 0) {
            return null;
        }

        // current_next_indicator が 0 のものは次に適用される内容なので使わない
        if ((section[5] & 0x01) === 0) {
            return null;
        }

        const originalNetworkId = (section[3] << 8) | section[4];
        const firstDescriptorsLength = ((section[8] & 0x0f) << 8) | section[9];

        const end = section.length - 4; // CRC_32 を除く
        let offset = 10 + firstDescriptorsLength;
        if (offset > end) {
            return null;
        }

        const broadcasters: BitBroadcaster[] = [];
        while (offset + 3 <= end) {
            const broadcasterId = section[offset];
            const descriptorsLength = ((section[offset + 1] & 0x0f) << 8) | section[offset + 2];
            offset += 3;
            if (offset + descriptorsLength > end) {
                break;
            }

            const broadcaster = BitParser.parseBroadcasterDescriptors(
                broadcasterId,
                section.subarray(offset, offset + descriptorsLength),
            );
            if (broadcaster !== null) {
                broadcasters.push(broadcaster);
            }
            offset += descriptorsLength;
        }

        return broadcasters.length === 0 ? null : { originalNetworkId: originalNetworkId, broadcasters: broadcasters };
    }

    /**
     * 放送事業者記述子ループから extended_broadcaster_descriptor を取り出す
     * @param broadcasterId: number
     * @param buffer: Buffer 記述子ループ
     * @return BitBroadcaster | null 系列情報を持たない場合は null
     */
    private static parseBroadcasterDescriptors(broadcasterId: number, buffer: Buffer): BitBroadcaster | null {
        let descriptors: aribts.TsDescriptorBase[];
        try {
            descriptors = new aribts.TsDescriptors(buffer).decode();
        } catch (err: any) {
            return null;
        }

        for (const descriptor of descriptors) {
            let d: aribts.Descriptor;
            try {
                d = descriptor.decode();
            } catch (err: any) {
                continue;
            }

            if (d.descriptor_tag !== BitParser.DESCRIPTOR_TAG_EXTENDED_BROADCASTER) {
                continue;
            }
            if (d.broadcaster_type !== BitParser.BROADCASTER_TYPE_TERRESTRIAL) {
                continue;
            }

            const affiliationIds: number[] = Array.isArray(d.affiliations)
                ? d.affiliations.map((a: any) => a.affiliation_id).filter((id: any) => typeof id === 'number')
                : [];

            const networkIds: number[] = Array.isArray(d.broadcasters)
                ? d.broadcasters
                      .filter((b: any) => b.broadcaster_id === broadcasterId)
                      .map((b: any) => b.original_network_id)
                      .filter((id: any) => typeof id === 'number')
                : [];

            return {
                broadcasterId: broadcasterId,
                terrestrialBroadcasterId:
                    typeof d.terrestrial_broadcaster_id === 'number' ? d.terrestrial_broadcaster_id : null,
                affiliationIds: affiliationIds,
                networkIds: networkIds,
            };
        }

        return null;
    }
}
