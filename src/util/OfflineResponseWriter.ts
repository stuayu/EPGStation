export interface OfflineResponseWritable {
    write(chunk: Buffer): boolean;
    once(event: 'drain', listener: () => void): unknown;
}

/** HTTP response の drain を待ち、保存レコードを 1 件ずつ下流へ渡す。 */
export const writeOfflineChunk = async (res: OfflineResponseWritable, chunk: Buffer): Promise<void> => {
    if (res.write(chunk) === false) await new Promise<void>(resolve => res.once('drain', resolve));
};

/** レコード単位の backpressure を維持したままストリームを転送する。 */
export const pipeOfflineRecords = async (
    res: OfflineResponseWritable,
    source: AsyncIterable<Buffer | string>,
): Promise<void> => {
    for await (const chunk of source) await writeOfflineChunk(res, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
};
