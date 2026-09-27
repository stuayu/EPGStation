import internal from 'stream';
import * as apid from '../../../../api';

interface SharedSource {
    sourceKey: string;
    stream: internal.Readable;
    branches: Set<internal.PassThrough>;
    closed: boolean;
}

export interface RecordingSourceLease {
    stream: internal.PassThrough;
    release(): void;
}

/** 録画間で上流を共有し、予約ごとに独立したストリーム枝を返す。 */
export default class RecordingSourceLeaseManager {
    private sources = new Map<string, SharedSource>();
    private openings = new Map<string, Promise<SharedSource>>();

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
            return this.acquire(channelId, openSource, compatibilityKey);
        }

        const branch = new internal.PassThrough();
        source.branches.add(branch);
        source.stream.pipe(branch);
        return this.createLease(source, branch);
    }

    private async open(sourceKey: string, openSource: () => Promise<internal.Readable>): Promise<SharedSource> {
        const stream = await openSource();
        const source: SharedSource = { sourceKey, stream, branches: new Set(), closed: false };
        const finish = (error?: Error): void => {
            if (source.closed === true) return;
            source.closed = true;
            if (this.sources.get(sourceKey) === source) this.sources.delete(sourceKey);
            for (const branch of source.branches) {
                stream.unpipe(branch);
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

    private createLease(source: SharedSource, branch: internal.PassThrough): RecordingSourceLease {
        let released = false;
        return {
            stream: branch,
            release: () => {
                if (released === true) return;
                released = true;
                this.release(source, branch);
            },
        };
    }

    private release(source: SharedSource, branch: internal.PassThrough): void {
        if (source.branches.delete(branch) === false) return;
        source.stream.unpipe(branch);
        if (branch.destroyed === false) branch.destroy();
        if (source.branches.size !== 0 || source.closed === true) return;

        source.closed = true;
        if (this.sources.get(source.sourceKey) === source) this.sources.delete(source.sourceKey);
        source.stream.destroy();
    }
}
