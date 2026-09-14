import { inject, injectable } from 'inversify';
import internal from 'stream';
import * as apid from '../../../../../api';
import ILogger from '../../../ILogger';
import ILoggerModel from '../../../ILoggerModel';
import IMirakurunClientModel from '../../../IMirakurunClientModel';
import ILiveStreamSourceManageModel, { LiveStreamSourceLease } from './ILiveStreamSourceManageModel';

interface SharedSource {
    channelId: apid.ChannelId;
    stream: internal.Readable;
    branches: Set<internal.PassThrough>;
    closed: boolean;
}

@injectable()
export default class LiveStreamSourceManageModel implements ILiveStreamSourceManageModel {
    private log: ILogger;
    private mirakurunClientModel: IMirakurunClientModel;
    private sources = new Map<apid.ChannelId, SharedSource>();
    private openings = new Map<apid.ChannelId, Promise<SharedSource>>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.log = logger.getLogger();
        this.mirakurunClientModel = mirakurunClientModel;
    }

    /**
     * channelId 単位で共有する Mirakurun 受信から配信枝を取得する
     * @param channelId: apid.ChannelId
     * @param priority: number Mirakurun の受信優先度
     * @return Promise<LiveStreamSourceLease>
     */
    public async acquire(channelId: apid.ChannelId, priority: number): Promise<LiveStreamSourceLease> {
        let source = this.sources.get(channelId);
        if (typeof source === 'undefined' || source.closed === true) {
            let opening = this.openings.get(channelId);
            if (typeof opening === 'undefined') {
                opening = this.open(channelId, priority);
                this.openings.set(channelId, opening);
            }

            try {
                source = await opening;
            } finally {
                if (this.openings.get(channelId) === opening) {
                    this.openings.delete(channelId);
                }
            }
        }

        if (source.closed === true || this.sources.get(channelId) !== source) {
            return await this.acquire(channelId, priority);
        }

        const branch = new internal.PassThrough();
        source.branches.add(branch);
        source.stream.pipe(branch);
        this.log.stream.debug(`reuse mirakurun service stream: ${channelId} (references: ${source.branches.size})`);

        let released = false;
        return {
            stream: branch,
            release: () => {
                if (released === true) {
                    return;
                }
                released = true;
                this.release(source as SharedSource, branch);
            },
        };
    }

    /**
     * channelId 用の Mirakurun 受信を開く
     * @param channelId: apid.ChannelId
     * @param priority: number Mirakurun の受信優先度
     * @return Promise<SharedSource>
     */
    private async open(channelId: apid.ChannelId, priority: number): Promise<SharedSource> {
        const mirakurun = this.mirakurunClientModel.getClient();
        mirakurun.priority = priority;
        this.log.stream.info(`get mirakurun service stream: ${channelId}`);

        const stream = await mirakurun.getServiceStream(channelId, true, priority).catch(err => {
            this.log.system.error(`get mirakurun service stream failed: ${channelId}`);
            throw err;
        });
        const source: SharedSource = {
            channelId,
            stream,
            branches: new Set(),
            closed: false,
        };

        const onClose = (): void => {
            if (source.closed === true) {
                return;
            }
            source.closed = true;
            if (this.sources.get(channelId) === source) {
                this.sources.delete(channelId);
            }
            for (const branch of source.branches) {
                source.stream.unpipe(branch);
                if (branch.destroyed === false) {
                    // upstream の error/close では pipe が destination を EOF にしない場合がある。
                    // 各配信へ EOF を伝えて、エンコーダと StreamManageModel の後始末を起動する。
                    branch.end();
                }
            }
            source.branches.clear();
            this.log.stream.info(`close shared mirakurun service stream: ${channelId}`);
        };
        stream.once('close', onClose);
        stream.once('end', onClose);
        stream.once('error', err => {
            this.log.system.error(`shared mirakurun service stream error: ${channelId}`);
            this.log.system.error(err);
            onClose();
            if (stream.destroyed === false) {
                stream.destroy();
            }
        });

        this.sources.set(channelId, source);

        return source;
    }

    /**
     * 配信枝を閉じ、最後の枝なら Mirakurun 受信も閉じる
     * @param source: SharedSource
     * @param branch: internal.PassThrough
     */
    private release(source: SharedSource, branch: internal.PassThrough): void {
        if (source.branches.delete(branch) === false) {
            return;
        }

        source.stream.unpipe(branch);
        if (branch.destroyed === false) {
            branch.destroy();
        }

        this.log.stream.debug(
            `release mirakurun service stream: ${source.channelId} (references: ${source.branches.size})`,
        );
        if (source.branches.size !== 0 || source.closed === true) {
            return;
        }

        source.closed = true;
        if (this.sources.get(source.channelId) === source) {
            this.sources.delete(source.channelId);
        }
        this.log.stream.info(`close shared mirakurun service stream: ${source.channelId}`);
        source.stream.destroy();
    }
}
