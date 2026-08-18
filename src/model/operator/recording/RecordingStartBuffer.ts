/**
 * 録画開始待ちの TS を有限量だけ保持するリングバッファ。
 * EIT[p/f] の通知が TS より遅れても番組冒頭を救えるようにするが、
 * 受信異常時にメモリを無制限に消費しない。
 */
export default class RecordingStartBuffer {
    private readonly maxBytes: number;
    private chunks: Buffer[] = [];
    private bytes = 0;

    public constructor(maxBytes: number = RecordingStartBuffer.DEFAULT_MAX_BYTES) {
        // 先頭を TS packet の途中にしないため、保持上限も packet 単位へ切り下げる
        this.maxBytes =
            Math.max(0, Math.floor(maxBytes / RecordingStartBuffer.TS_PACKET_SIZE)) *
            RecordingStartBuffer.TS_PACKET_SIZE;
    }

    /** TS チャンクを末尾へ追加し、上限超過分を先頭から捨てる */
    public push(chunk: Buffer): void {
        if (this.maxBytes === 0 || chunk.length === 0) return;

        this.chunks.push(Buffer.from(chunk));
        this.bytes += chunk.length;
        // stream 先頭から packet 単位で捨てる。任意 byte 数を削ると録画ファイルが
        // 0x47 以外から始まり、TS analyzer / ffprobe の初期同期を悪化させる
        let bytesToDrop =
            Math.ceil((this.bytes - this.maxBytes) / RecordingStartBuffer.TS_PACKET_SIZE) *
            RecordingStartBuffer.TS_PACKET_SIZE;
        while (bytesToDrop > 0 && this.chunks.length > 0) {
            const first = this.chunks[0];
            if (first.length <= bytesToDrop) {
                this.chunks.shift();
                this.bytes -= first.length;
                bytesToDrop -= first.length;
            } else {
                this.chunks[0] = first.subarray(bytesToDrop);
                this.bytes -= bytesToDrop;
                bytesToDrop = 0;
            }
        }
    }

    /** 保持中の TS を受信順で取り出し、バッファを空にする */
    public drain(): Buffer[] {
        const result = this.chunks;
        this.chunks = [];
        this.bytes = 0;
        return result;
    }

    /** 保持バイト数 */
    public get byteLength(): number {
        return this.bytes;
    }

    public static readonly DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
    private static readonly TS_PACKET_SIZE = 188;
}
