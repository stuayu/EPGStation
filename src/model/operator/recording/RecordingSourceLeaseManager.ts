import internal from 'stream';
import * as apid from '../../../../api';

interface SharedSource {
    sourceKey: string;
    stream: internal.Readable;
    branches: Set<internal.PassThrough>;
    closed: boolean;
    onData: (chunk: Buffer) => void;
}

// 30 秒分の BS4K 相当 (約 4 MB/s)。詰まった枝だけに保持し、超過時はその枝を再接続させる。
const MAX_BRANCH_BUFFER_BYTES = 128 * 1024 * 1024;

export interface RecordingSourceLease {
    stream: internal.PassThrough;
    release(): void;
}

/** 録画間で上流を共有し、予約ごとに独立したストリーム枝を返す。 */
export default class RecordingSourceLeaseManager {
    private sources = new Map<string, SharedSource>();
    private openings = new Map<string, Promise<SharedSource>>();

    constructor(private log?: (message: string) => void) {}

    /**
     * channelId と compatibilityKey が一致する共有上流から予約用の枝を取得する。
     * @param channelId: apid.ChannelId
     * @param openSource: () => Promise<internal.Readable>
     * @param compatibilityKey: string priority / decode など共有条件のキー
     * @return Promise<RecordingSourceLease>
     */
    public async acquire(
        channelId: apid.ChannelId,
        openSource: () => Promise<internal.Readable>,
        compatibilityKey: string = '',
        details: { reserveId: number; priority: number } = { reserveId: -1, priority: 0 },
    ): Promise<RecordingSourceLease> {
        const sourceKey = `${channelId}:${compatibilityKey}`;
        let source = this.sources.get(sourceKey);
        if (source === undefined || source.closed === true) {
            let opening = this.openings.get(sourceKey);
            if (opening === undefined) {
                opening = this.open(sourceKey, openSource);
                this.openings.set(sourceKey, opening);
            }
            try {
                source = await opening;
            } finally {
                if (this.openings.get(sourceKey) === opening) this.openings.delete(sourceKey);
            }
        }

        if (source.closed === true || this.sources.get(sourceKey) !== source) {
            return this.acquire(channelId, openSource, compatibilityKey, details);
        }

        const branch = new internal.PassThrough();
        source.branches.add(branch);
        branch.on('drain', () => {});
        this.log?.(
            `recording upstream lease ${source.branches.size === 1 ? 'created' : 'reused'}: ` +
                `channelId: ${channelId}, priority: ${details.priority}, ` +
                `references: ${source.branches.size}, ` +
                `reserveId: ${details.reserveId}`,
        );
        branch.once('error', error => {
            if (error.message === 'recording source branch buffer limit exceeded') {
                this.log?.(
                    `recording upstream branch buffer limit exceeded: reserveId: ${details.reserveId}, ` +
                        `writableLength: ${(error as Error & { writableLength?: number }).writableLength ?? branch.writableLength}`,
                );
            }
        });
        return this.createLease(source, branch, details);
    }

    private async open(sourceKey: string, openSource: () => Promise<internal.Readable>): Promise<SharedSource> {
        const stream = await openSource();
        const branches = new Set<internal.PassThrough>();
        const onData = (chunk: Buffer): void => {
            for (const branch of branches) {
                if (branch.destroyed) continue;
                if (branch.writableLength + chunk.length > MAX_BRANCH_BUFFER_BYTES) {
                    const error = new Error('recording source branch buffer limit exceeded') as Error & {
                        writableLength: number;
                    };
                    error.writableLength = branch.writableLength;
                    branch.destroy(error);
                } else {
                    branch.write(chunk);
                }
            }
        };
        const source: SharedSource = { sourceKey, stream, branches, closed: false, onData };
        stream.on('data', onData);
        const finish = (error?: Error): void => {
            if (source.closed === true) return;
            source.closed = true;
            stream.removeListener('data', source.onData);
            if (this.sources.get(sourceKey) === source) this.sources.delete(sourceKey);
            for (const branch of source.branches) {
                if (branch.destroyed === false) {
                    if (error === undefined) branch.end();
                    else branch.destroy(error);
                }
            }
            source.branches.clear();
        };
        stream.once('end', () => finish());
        stream.once('close', () => finish());
        stream.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
        this.sources.set(sourceKey, source);
        return source;
    }

    private createLease(
        source: SharedSource,
        branch: internal.PassThrough,
        details: { reserveId: number; priority: number },
    ): RecordingSourceLease {
        let released = false;
        return {
            stream: branch,
            release: () => {
                if (released === true) return;
                released = true;
                this.release(source, branch, details);
            },
        };
    }

    private release(
        source: SharedSource,
        branch: internal.PassThrough,
        details: { reserveId: number; priority: number },
    ): void {
        if (source.branches.delete(branch) === false) return;
        if (branch.destroyed === false) branch.destroy();
        this.log?.(
            `recording upstream branch removed: sourceKey: ${source.sourceKey}, references: ${source.branches.size}, reserveId: ${details.reserveId}`,
        );
        if (source.branches.size !== 0 || source.closed === true) return;

        source.closed = true;
        source.stream.removeListener('data', source.onData);
        if (this.sources.get(source.sourceKey) === source) this.sources.delete(source.sourceKey);
        source.stream.destroy();
        this.log?.(
            `recording upstream closed: sourceKey: ${source.sourceKey}, references: 0, reserveId: ${details.reserveId}`,
        );
    }
}
