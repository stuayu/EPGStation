import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IStreamApiModel from '../../api/streams/IStreamApiModel';
import { getClientCapabilities } from '@/util/ClientCapabilityUtil';
import IPlaybackOptionsState, { PlaybackPreference } from './IPlaybackOptionsState';

const KEY = 'epgstation.playback.preferences';
const DEFAULT: PlaybackPreference = { preferredQuality: 'auto', videoCorrection: 'auto', hdrMode: 'auto', autoPlayWithRecommendedQuality: true, mobileDataPreference: true };

@injectable()
export default class PlaybackOptionsState implements IPlaybackOptionsState {
    public options: apid.PlaybackOptions | null = null;
    public preference: PlaybackPreference = PlaybackOptionsState.readPreference();
    public selectedPresetId = 'auto';

    constructor(@inject('IStreamApiModel') private readonly api: IStreamApiModel) {}

    public async loadLive(channelId: apid.ChannelId, container?: apid.PlaybackContainer): Promise<void> {
        this.options = await this.api.getLivePlaybackOptions(channelId, await getClientCapabilities(), this.preference.preferredQuality, container);
        this.selectedPresetId = this.options.recommended.id;
    }

    public async loadRecorded(videoFileId: apid.VideoFileId, container?: apid.PlaybackContainer): Promise<void> {
        this.options = await this.api.getRecordedPlaybackOptions(videoFileId, await getClientCapabilities(), this.preference.preferredQuality, container);
        this.selectedPresetId = this.options.recommended.id;
    }

    public selectPreset(id: string): void {
        if (this.options?.profiles.some(profile => profile.id === id) === true || id === 'auto') this.selectedPresetId = id;
    }

    /**
     * API が返した順序を優先して fallback 候補を返す。
     * @return fallback 対象のプリセット識別子
     */
    public getFallbackChain(): string[] {
        return this.options?.recommended.fallbackChain ?? this.options?.profiles.map(profile => profile.id) ?? [];
    }

    public savePreference(value: Partial<PlaybackPreference>): void {
        this.preference = { ...this.preference, ...value };
        try {
            localStorage.setItem(KEY, JSON.stringify(this.preference));
        } catch (_err) {
            // localStorage が使えない環境でもセッション中は使用可能
        }
    }

    public clear(): void {
        this.options = null;
        this.selectedPresetId = 'auto';
    }

    private static readPreference(): PlaybackPreference {
        try {
            const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlaybackPreference> | null;
            return { ...DEFAULT, ...(value ?? {}) };
        } catch (_err) {
            return { ...DEFAULT };
        }
    }
}
