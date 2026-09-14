export interface OfflineResponseWritable {
    write(chunk: Buffer): boolean;
    once(event: 'drain' | 'close' | 'error', listener: () => void): unknown;
    removeListener?(event: 'drain' | 'close' | 'error', listener: () => void): unknown;
    writableEnded?: boolean;
    destroyed?: boolean;
}

/**
 * HTTP response の drain を待ち、保存レコードを 1 件ずつ下流へ渡す。
 * クライアントが切断すると drain は二度と来ないため、close / error でも待ちを解く
 * (解かないとこの非同期処理が永久に保留され、読み出し元の参照も残る)
 * @return boolean 書き込みを続けてよいなら true、切断済みなら false
 */
export const writeOfflineChunk = async (res: OfflineResponseWritable, chunk: Buffer): Promise<boolean> => {
    if (res.destroyed === true || res.writableEnded === true) return false;
    if (res.write(chunk) === true) return true;

    return await new Promise<boolean>(resolve => {
        const finish = (writable: boolean): void => {
            res.removeListener?.('drain', onDrain);
            res.removeListener?.('close', onClose);
            res.removeListener?.('error', onClose);
            resolve(writable);
        };
        const onDrain = (): void => finish(true);
        const onClose = (): void => finish(false);
        res.once('drain', onDrain);
        res.once('close', onClose);
        res.once('error', onClose);
    });
};

/** レコード単位の backpressure を維持したままストリームを転送する。 */
export const pipeOfflineRecords = async (
    res: OfflineResponseWritable,
    source: AsyncIterable<Buffer | string>,
    isClosed: () => boolean = () => false,
): Promise<void> => {
    for await (const chunk of source) {
        // 切断後は読み出しをやめる (エンコーダの停止は呼び出し側の cleanup が行う)
        if (isClosed() === true) return;
        const writable = await writeOfflineChunk(res, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        if (writable === false) return;
    }
};
