import * as apid from '../../../../api';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';

export interface PlaybackOptions {
    source: apid.SourceCapabilities;
    recommended: { id: string; resolvedId: string; label: string; reason: string; fallbackChain: string[] };
    profiles: Array<{ id: string; label: string; detail: string; available: true; builtin: boolean; legacy: boolean }>;
    options: { hdr: string[]; correction: string[] };
}

export default interface IPlaybackApiModel {
    getLivePlaybackOptions(
        channelId: apid.ChannelId,
        client: ClientCapabilities,
        requestedPresetId?: string,
    ): Promise<PlaybackOptions>;
    getRecordedPlaybackOptions(
        videoFileId: apid.VideoFileId,
        client: ClientCapabilities,
        requestedPresetId?: string,
    ): Promise<PlaybackOptions>;
}
