import * as apid from '../../../../api';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import { PlaybackPreference } from '../../stream/resolver/IPlaybackPolicyResolver';

export interface PlaybackOptions {
    source: apid.SourceCapabilities;
    recommended: { id: string; resolvedId: string; label: string; reason: string; fallbackChain: string[] };
    profiles: Array<{
        id: string;
        label: string;
        detail: string;
        available: true;
        builtin: boolean;
        legacy: boolean;
        modes: Partial<Record<'m2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls', number>>;
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
