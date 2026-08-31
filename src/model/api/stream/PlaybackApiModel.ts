import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IVideoFileDB from '../../db/IVideoFileDB';
import ISourceAnalyzer from '../../stream/capability/ISourceAnalyzer';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import IPlaybackPolicyResolver from '../../stream/resolver/IPlaybackPolicyResolver';
import IStreamPresetRegistry, { StreamPresetScope } from '../../stream/preset/IStreamPresetRegistry';
import IPlaybackApiModel, { PlaybackOptions } from './IPlaybackApiModel';

@injectable()
export default class PlaybackApiModel implements IPlaybackApiModel {
    constructor(
        @inject('ISourceAnalyzer') private readonly sourceAnalyzer: ISourceAnalyzer,
        @inject('IStreamPresetRegistry') private readonly presetRegistry: IStreamPresetRegistry,
        @inject('IPlaybackPolicyResolver') private readonly resolver: IPlaybackPolicyResolver,
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
    ) {}

    public async getLivePlaybackOptions(
        channelId: apid.ChannelId,
        client: ClientCapabilities,
        requestedPresetId?: string,
    ): Promise<PlaybackOptions> {
        return this.create('live', await this.sourceAnalyzer.analyzeLiveChannel(channelId), client, requestedPresetId);
    }

    public async getRecordedPlaybackOptions(
        videoFileId: apid.VideoFileId,
        client: ClientCapabilities,
        requestedPresetId?: string,
    ): Promise<PlaybackOptions> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');
        const scope: StreamPresetScope = video.type === 'encoded' ? 'recorded-encoded' : 'recorded-ts';
        return this.create(
            scope,
            await this.sourceAnalyzer.analyzeRecordedFile(videoFileId),
            client,
            requestedPresetId,
        );
    }

    private create(
        scope: StreamPresetScope,
        source: apid.SourceCapabilities,
        client: ClientCapabilities,
        requestedPresetId?: string,
    ): PlaybackOptions {
        const presets = this.presetRegistry.getPresets(scope, source, client);
        const decision = this.resolver.resolve(scope, source, client, presets, requestedPresetId);
        const resolved =
            requestedPresetId === undefined || requestedPresetId === 'auto' ? decision.presetId : requestedPresetId;
        return {
            source,
            recommended: {
                id: 'auto',
                resolvedId: resolved,
                label: decision.label,
                reason: decision.reason,
                fallbackChain: decision.fallbackChain,
            },
            profiles: presets
                .filter(preset => preset.id !== 'auto' && this.isDecisionUsable(preset, source, client))
                .map(preset => ({
                    id: preset.id,
                    label: preset.name,
                    detail: preset.detail ?? preset.description ?? '',
                    available: true as const,
                })),
            options: { hdr: ['auto', 'preserve', 'sdr'], correction: ['auto', 'off', 'bright'] },
        };
    }

    private isDecisionUsable(
        preset: import('../../stream/preset/IStreamPreset').StreamPreset,
        source: apid.SourceCapabilities,
        client: ClientCapabilities,
    ): boolean {
        try {
            this.resolver.resolve('live', source, client, [preset], preset.id);
            return true;
        } catch (_err) {
            return false;
        }
    }
}
