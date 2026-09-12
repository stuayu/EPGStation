import { inject, injectable, optional } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import IChannelDB from '../../db/IChannelDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IVideoUtil, { VideoDetailInfo } from '../../api/video/IVideoUtil';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { SourceCapabilities } from './ISourceCapabilities';
import ISourceAnalyzer from './ISourceAnalyzer';
import {
    hasReliableDeinterlaceInput,
    shouldDeinterlace,
    toDeinterlaceInput,
} from '../../../util/DeinterlaceUtil';
import { toSourceCapabilities } from '../../../util/SourceCapabilityUtil';
import { classifySource } from '../../../util/SourceClassUtil';

const RECORDED_CACHE_TTL_MS = 30 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 10 * 1000;

interface CacheEntry {
    value: SourceCapabilities;
    expiresAt: number;
    source: 'ffprobe' | 'db-fallback' | 'channel-default';
}

const legacyLiveSource = (): SourceCapabilities => ({
    transport: 'mpegts',
    codec: 'mpeg2',
    width: 1920,
    height: 1080,
    bitDepth: 8,
    scan: 'interlaced',
    frameRate: 29.97,
    fieldOrder: 'tff',
    colorPrimaries: 'bt709',
    transfer: 'bt709',
    hdr: 'sdr',
    sourceClass: 'legacy-broadcast',
    confidence: 'medium',
});

const bs4kLiveSource = (): SourceCapabilities => ({
    transport: 'mpegts',
    codec: 'hevc',
    width: 3840,
    height: 2160,
    bitDepth: 10,
    scan: 'progressive',
    frameRate: 59.94,
    fieldOrder: 'unknown',
    colorPrimaries: 'bt2020',
    transfer: 'hlg',
    hdr: 'hlg',
    sourceClass: 'bs4k',
    confidence: 'medium',
});

@injectable()
export default class SourceAnalyzer implements ISourceAnalyzer {
    private readonly recordedCache = new Map<apid.VideoFileId, CacheEntry>();
    private readonly liveCache = new Map<apid.ChannelId, CacheEntry>();

    constructor(
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IVideoUtil') private readonly videoUtil: IVideoUtil,
        @inject('IChannelDB') private readonly channelDB: IChannelDB,
        @inject('ILoggerModel') @optional() logger?: ILoggerModel,
    ) {
        this.log = logger?.getLogger();
    }

    private readonly log?: ILogger;

    public async analyzeRecordedFile(videoFileId: apid.VideoFileId): Promise<SourceCapabilities> {
        const cached = this.getCached(this.recordedCache, videoFileId);
        if (cached !== null) {
            this.logDeinterlace(cached.source, cached.value);
            return cached.value;
        }

        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');

        let source: SourceCapabilities;
        let sourceKind: CacheEntry['source'];
        const filePath =
            typeof this.videoUtil.getFullFilePathFromVideoFile === 'function'
                ? this.videoUtil.getFullFilePathFromVideoFile(video)
                : null;
        if (filePath !== null) {
            try {
                // 配信 cmd のデインターレース要否には DB の codec / 解像度だけでなく、
                // ffprobe の field_order / fps が必要。解析済みでもここは再取得する。
                source = this.fromDetailedInfo(await this.videoUtil.getDetailedInfo(filePath), filePath);
                sourceKind = 'ffprobe';
            } catch (err) {
                if (video.analyzedAt === null || typeof video.analyzedAt === 'undefined') throw err;
                // video_file / video_file_ts_info には現時点で fps / field_order が無い。
                // 不明なまま progressive と仮定すると放送 TS の yadif を外すため、安全側へ倒す。
                source = this.fromVideoFile(video, filePath);
                sourceKind = 'db-fallback';
            }
        } else if (video.analyzedAt !== null && typeof video.analyzedAt !== 'undefined') {
            // パス解決失敗も ffprobe 失敗と同じ DB fallback。警告を出さずに通っていたため、
            // deinterlace ログの source で実行時の枝を判別できるようにする。
            source = this.fromVideoFile(video);
            sourceKind = 'db-fallback';
        } else {
            throw new Error('VideoFilePathIsUndefined');
        }

        this.logDeinterlace(sourceKind, source);
        // DB fallback、または ffprobe で判定材料が欠けた結果は再解析を阻害するためキャッシュしない。
        if (hasReliableDeinterlaceInput(toDeinterlaceInput(source))) {
            this.recordedCache.set(videoFileId, this.entry(source, RECORDED_CACHE_TTL_MS, sourceKind));
        }
        return source;
    }

    public async analyzeLiveChannel(channelId: apid.ChannelId): Promise<SourceCapabilities> {
        const cached = this.getCached(this.liveCache, channelId);
        if (cached !== null) {
            this.logDeinterlace(cached.source, cached.value);
            return cached.value;
        }

        const channel = await this.channelDB.findId(channelId);
        if (channel === null) throw new Error('ChannelIsUndefined');
        const source =
            channel.channelType === 'BS4K' || channel.channelType === 'CS4K' ? bs4kLiveSource() : legacyLiveSource();
        this.logDeinterlace('channel-default', source);
        this.liveCache.set(channelId, this.entry(source, LIVE_CACHE_TTL_MS, 'channel-default'));
        return source;
    }

    private fromVideoFile(video: VideoFile, filePath?: string): SourceCapabilities {
        const source = toSourceCapabilities({
            codec_name: video.videoCodec ?? undefined,
            width: video.width ?? undefined,
            height: video.height ?? undefined,
        });
        source.transport = this.transportFromPath(filePath ?? video.filePath);
        source.sourceClass = classifySource(source);
        return source;
    }

    private fromDetailedInfo(info: VideoDetailInfo, filePath?: string): SourceCapabilities {
        const source = toSourceCapabilities({
            codec_name: info.videoCodec ?? undefined,
            width: info.width ?? undefined,
            height: info.height ?? undefined,
            pix_fmt: info.pixFmt ?? undefined,
            bits_per_raw_sample: info.bitsPerRawSample ?? undefined,
            field_order: info.fieldOrder ?? undefined,
            avg_frame_rate: info.avgFrameRate ?? undefined,
            r_frame_rate: info.rFrameRate ?? undefined,
            color_transfer: info.colorTransfer ?? undefined,
            color_primaries: info.colorPrimaries ?? undefined,
        });
        source.transport = this.transportFromPath(filePath);
        source.sourceClass = classifySource(source);
        return source;
    }

    private transportFromPath(filePath?: string): SourceCapabilities['transport'] {
        const extension = filePath === undefined ? '' : path.extname(filePath).toLowerCase();
        if (extension === '.ts' || extension === '.m2ts' || extension === '.mts') return 'mpegts';
        if (extension === '.mp4' || extension === '.m4v' || extension === '.mov') return 'mp4';
        return extension === '.webm' ? 'other' : undefined;
    }

    private entry(value: SourceCapabilities, ttl: number, source: CacheEntry['source']): CacheEntry {
        return { value, expiresAt: Date.now() + ttl, source };
    }

    private getCached<K>(cache: Map<K, CacheEntry>, key: K): CacheEntry | null {
        const entry = cache.get(key);
        if (entry === undefined) return null;
        if (entry.expiresAt <= Date.now()) {
            cache.delete(key);
            return null;
        }
        return entry;
    }

    private logDeinterlace(source: CacheEntry['source'], capabilities: SourceCapabilities): void {
        if (this.log === undefined) return;
        const input = toDeinterlaceInput(capabilities);
        const fps = typeof input.fps === 'number' ? input.fps.toFixed(2) : (input.fps ?? 'unknown');
        const codec = input.codec ?? 'unknown';
        const fieldOrder = input.field_order ?? 'unknown';
        this.log.stream.info(
            `deinterlace: yadif=${shouldDeinterlace(input)} (source: ${source}, codec: ${codec}, ` +
                `field_order: ${fieldOrder}, fps: ${fps})`,
        );
    }
}
