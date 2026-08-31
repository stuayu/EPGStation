import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import IChannelDB from '../../db/IChannelDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IVideoUtil, { VideoDetailInfo } from '../../api/video/IVideoUtil';
import { SourceCapabilities } from './ISourceCapabilities';
import ISourceAnalyzer from './ISourceAnalyzer';
import { toSourceCapabilities } from '../../../util/SourceCapabilityUtil';
import { classifySource } from '../../../util/SourceClassUtil';

const RECORDED_CACHE_TTL_MS = 30 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 10 * 1000;

interface CacheEntry {
    value: SourceCapabilities;
    expiresAt: number;
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
    ) {}

    public async analyzeRecordedFile(videoFileId: apid.VideoFileId): Promise<SourceCapabilities> {
        const cached = this.getCached(this.recordedCache, videoFileId);
        if (cached !== null) return cached;

        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');

        let source: SourceCapabilities;
        if (video.analyzedAt !== null && typeof video.analyzedAt !== 'undefined') {
            source = this.fromVideoFile(video);
        } else {
            const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (filePath === null) throw new Error('VideoFilePathIsUndefined');
            source = this.fromDetailedInfo(await this.videoUtil.getDetailedInfo(filePath));
        }

        this.recordedCache.set(videoFileId, this.entry(source, RECORDED_CACHE_TTL_MS));
        return source;
    }

    public async analyzeLiveChannel(channelId: apid.ChannelId): Promise<SourceCapabilities> {
        const cached = this.getCached(this.liveCache, channelId);
        if (cached !== null) return cached;

        const channel = await this.channelDB.findId(channelId);
        if (channel === null) throw new Error('ChannelIsUndefined');
        const source =
            channel.channelType === 'BS4K' || channel.channelType === 'CS4K' ? bs4kLiveSource() : legacyLiveSource();
        this.liveCache.set(channelId, this.entry(source, LIVE_CACHE_TTL_MS));
        return source;
    }

    private fromVideoFile(video: VideoFile): SourceCapabilities {
        const source = toSourceCapabilities({
            codec_name: video.videoCodec ?? undefined,
            width: video.width ?? undefined,
            height: video.height ?? undefined,
        });
        source.sourceClass = classifySource(source);
        return source;
    }

    private fromDetailedInfo(info: VideoDetailInfo): SourceCapabilities {
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
        source.sourceClass = classifySource(source);
        return source;
    }

    private entry(value: SourceCapabilities, ttl: number): CacheEntry {
        return { value, expiresAt: Date.now() + ttl };
    }

    private getCached<K>(cache: Map<K, CacheEntry>, key: K): SourceCapabilities | null {
        const entry = cache.get(key);
        if (entry === undefined) return null;
        if (entry.expiresAt <= Date.now()) {
            cache.delete(key);
            return null;
        }
        return entry.value;
    }
}
