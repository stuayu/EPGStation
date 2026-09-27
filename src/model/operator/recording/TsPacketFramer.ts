/** MPEG-TS の入力を 188 byte パケット境界へ揃える。 */
export default class TsPacketFramer {
    private buffer: Buffer = Buffer.alloc(0);
    private synchronized: boolean = false;

    /** 完全な TS パケットだけを返す。同期が確立できない場合は null。 */
    public push(chunk: Buffer): Buffer | null {
        if (chunk.length === 0) return null;
        this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

        const output: Buffer[] = [];
        while (true) {
            if (!this.synchronized) {
                const syncAt = this.findSync();
                if (syncAt < 0) {
                    // 2 パケット分は次チャンクと照合するため保持する。
                    const keepFrom = Math.max(0, this.buffer.length - 2 * TsPacketFramer.PACKET_SIZE);
                    this.buffer = this.buffer.subarray(keepFrom);
                    break;
                }
                this.buffer = this.buffer.subarray(syncAt);
                this.synchronized = true;
            }

            if (this.buffer.length < TsPacketFramer.PACKET_SIZE) break;
            if (this.buffer[0] !== TsPacketFramer.SYNC_BYTE) {
                this.synchronized = false;
                this.buffer = this.buffer.subarray(1);
                continue;
            }

            const fullPackets = Math.floor(this.buffer.length / TsPacketFramer.PACKET_SIZE);
            let validCount = 0;
            while (validCount < fullPackets) {
                const next = validCount * TsPacketFramer.PACKET_SIZE;
                if (this.buffer[next] !== TsPacketFramer.SYNC_BYTE) break;
                validCount++;
            }
            if (validCount === 0) continue;
            const length = validCount * TsPacketFramer.PACKET_SIZE;
            output.push(Buffer.from(this.buffer.subarray(0, length)));
            this.buffer = this.buffer.subarray(length);
            if (validCount < fullPackets) this.synchronized = false;
        }
        return output.length === 0 ? null : Buffer.concat(output);
    }

    /** 未完成パケットを破棄し、破棄 byte 数を返す。 */
    public reset(): number {
        const discarded = this.buffer.length;
        this.buffer = Buffer.alloc(0);
        this.synchronized = false;
        return discarded;
    }

    private findSync(): number {
        for (let i = 0; i + 2 * TsPacketFramer.PACKET_SIZE < this.buffer.length; i++) {
            if (
                this.buffer[i] === TsPacketFramer.SYNC_BYTE &&
                this.buffer[i + TsPacketFramer.PACKET_SIZE] === TsPacketFramer.SYNC_BYTE &&
                this.buffer[i + 2 * TsPacketFramer.PACKET_SIZE] === TsPacketFramer.SYNC_BYTE
            )
                return i;
        }
        return -1;
    }

    private static readonly PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
}
