import * as apid from '../../../../../api';

export type PlaybackPreference = {
    preferredQuality: string;
    videoCorrection: string;
    hdrMode: string;
    autoPlayWithRecommendedQuality: boolean;
    mobileDataPreference: boolean;
};

export default interface IPlaybackOptionsState {
    options: apid.PlaybackOptions | null;
    preference: PlaybackPreference;
    selectedPresetId: string;
    getFallbackChain(): string[];
    loadLive(channelId: apid.ChannelId): Promise<void>;
    loadRecorded(videoFileId: apid.VideoFileId): Promise<void>;
    selectPreset(id: string): void;
    savePreference(value: Partial<PlaybackPreference>): void;
    clear(): void;
}
