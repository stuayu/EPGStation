import * as apid from '../../../../api';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import { PlaybackPreference } from '../../stream/resolver/IPlaybackPolicyResolver';

export interface PlaybackOptions {
    source: apid.SourceCapabilities;
    recommended: { id: string; resolvedId: string; label: string; reason: string; fallbackChain: string[] };
    profiles: Array<{
        id: string;
        // 画質の役割。表示ラベルの引き当てに使う。該当しないプリセットは null
        role: string | null;
        label: string;
        detail: string;
        available: true;
        builtin: boolean;
        legacy: boolean;
        modes: Partial<Record<'m2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls', number>>;
        // 映像 bitrate (kbps)。自動画質 fallback の帯域判定に使う
        videoBitrate?: number;
        // 出力映像コーデック。同じ role のプリセットが複数あるとき (HEVC 版 / AVC 版) の区別に使う
        videoCodec?: 'copy' | 'h264' | 'hevc';
        // コンテナ別に「主音声・副音声を再接続無しで同時配信できるか」。詳細は api.d.ts の PlaybackProfile を参照
        embeddedAudioSwitch?: Partial<Record<'m2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls', boolean>>;
    }>;
    options: { hdr: string[]; correction: string[] };
}

export default interface IPlaybackApiModel {
    getLivePlaybackOptions(
        channelId: apid.ChannelId,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
        preference?: PlaybackPreference,
    ): Promise<PlaybackOptions>;
    getRecordedPlaybackOptions(
        videoFileId: apid.VideoFileId,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
        preference?: PlaybackPreference,
    ): Promise<PlaybackOptions>;
}
