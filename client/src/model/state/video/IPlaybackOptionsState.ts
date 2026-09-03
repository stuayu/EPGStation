import * as apid from '../../../../../api';

export type PlaybackPreference = {
    preferredQuality: string;
    videoCorrection: string;
    hdrMode: string;
    autoPlayWithRecommendedQuality: boolean;
    mobileDataPreference: boolean;
    // 画質選択一覧で技術的な詳細 (mode 番号など) まで表示するか。全画面で共通の設定として永続化する
    showQualityDetail: boolean;
};

export default interface IPlaybackOptionsState {
    options: apid.PlaybackOptions | null;
    preference: PlaybackPreference;
    selectedPresetId: string;
    getFallbackChain(): string[];
    loadLive(channelId: apid.ChannelId, container?: apid.PlaybackContainer): Promise<void>;
    loadRecorded(videoFileId: apid.VideoFileId, container?: apid.PlaybackContainer): Promise<void>;
    selectPreset(id: string): void;
    savePreference(value: Partial<PlaybackPreference>): void;
    clear(): void;
}
