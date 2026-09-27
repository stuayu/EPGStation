import * as fs from 'fs';
import * as stream from 'stream';

/** 録画ファイルへの単一書き込み経路を保持する。 */
export default class RecordingSink {
    public readonly passThrough: stream.PassThrough;
    private readonly file: fs.WriteStream;
    private finished: Promise<void> | null = null;
    private bytesWritten = 0;

    constructor(file: fs.WriteStream, passThrough: stream.PassThrough) {
        this.file = file;
        this.passThrough = passThrough;
        this.passThrough.pipe(this.file);
    }

    /** TS パケット列を書き込み、背圧の有無を返す。 */
    public write(data: Buffer): boolean {
        if (data.length === 0) return true;
        this.bytesWritten += data.length;
        return this.passThrough.write(data);
    }

    /** 現在のファイル末尾 byte 位置を返す。 */
    public getBytesWritten(): number {
        return this.bytesWritten;
    }

    /** バッファを捨てずに閉じ、finish を最大 10 秒待つ。 */
    public async finish(timeoutMs: number = 10_000): Promise<void> {
        if (this.finished !== null) return this.finished;
        this.finished = new Promise<void>((resolve, reject) => {
            if (this.file.closed === true || this.file.writableFinished === true) {
                resolve();
                return;
            }
            const timeout = setTimeout(() => reject(new Error('RecordingSinkFinishTimeout')), timeoutMs);
            this.file.once('finish', () => {
                clearTimeout(timeout);
                resolve();
            });
            this.file.once('error', err => {
                clearTimeout(timeout);
                reject(err);
            });
            this.passThrough.end();
        });
        return this.finished;
    }
}
