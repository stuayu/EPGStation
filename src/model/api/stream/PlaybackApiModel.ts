import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IVideoFileDB from '../../db/IVideoFileDB';
import ISourceAnalyzer from '../../stream/capability/ISourceAnalyzer';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import IPlaybackPolicyResolver from '../../stream/resolver/IPlaybackPolicyResolver';
import IStreamPresetRegistry, { StreamPresetScope } from '../../stream/preset/IStreamPresetRegistry';
import { StreamPreset } from '../../stream/preset/IStreamPreset';
import { BUILTIN_STREAM_PRESETS } from '../../../util/BuiltinStreamPresets';
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
        container?: apid.PlaybackContainer,
    ): Promise<PlaybackOptions> {
        return this.create(
            'live',
            await this.sourceAnalyzer.analyzeLiveChannel(channelId),
            client,
            requestedPresetId,
            container,
        );
    }

    public async getRecordedPlaybackOptions(
        videoFileId: apid.VideoFileId,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
    ): Promise<PlaybackOptions> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');
        const scope: StreamPresetScope = video.type === 'encoded' ? 'recorded-encoded' : 'recorded-ts';
        return this.create(
            scope,
            await this.sourceAnalyzer.analyzeRecordedFile(videoFileId),
            client,
            requestedPresetId,
            container,
        );
    }

    private create(
        scope: StreamPresetScope,
        source: apid.SourceCapabilities,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
    ): PlaybackOptions {
        const allPresets = this.presetRegistry.getPresets(scope, source, client);
        const modeMap =
            typeof this.presetRegistry.getModeMap === 'function'
                ? this.presetRegistry.getModeMap(scope)
                : { m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] };
        const presets =
            container === undefined || container === 'normal'
                ? allPresets
                : allPresets.filter(preset => preset.id === 'auto' || modeMap[container]?.includes(preset.id) === true);
        const decision = this.resolver.resolve(scope, source, client, presets, requestedPresetId);
        const resolved = decision.presetId;
        const resolvedPreset = presets.find(preset => preset.id === resolved);
        const resolvedRole = resolvedPreset === undefined ? null : this.builtinRole(resolvedPreset);
        const recommendedLabel =
            resolvedRole === null
                ? decision.label
                : (BUILTIN_STREAM_PRESETS.find(preset => preset.id === resolvedRole)?.name ?? decision.label);
        return {
            source,
            recommended: {
                id: 'auto',
                resolvedId: resolved,
                label: recommendedLabel,
                reason: decision.reason,
                fallbackChain: decision.fallbackChain,
            },
            profiles: this.createProfiles(
                presets.filter(preset => preset.id === 'auto' || this.isDecisionUsable(preset, source, client)),
                decision.reason,
                scope,
                resolved,
                container,
            ),
            options: { hdr: ['auto', 'preserve', 'sdr'], correction: ['auto', 'off', 'bright'] },
        };
    }

    private createProfiles(
        presets: StreamPreset[],
        autoReason: string,
        scope: StreamPresetScope,
        resolvedId: string,
        container?: apid.PlaybackContainer,
    ): PlaybackOptions['profiles'] {
        // 古いテスト用 registry / 旧配備との互換。実 registry は必ず mode map を返す。
        const modeMap =
            typeof this.presetRegistry.getModeMap === 'function'
                ? this.presetRegistry.getModeMap(scope)
                : { m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] };
        const roles = presets.map(preset => this.builtinRole(preset));
        const representatives = new Map<string, StreamPreset>();
        for (const preset of presets) {
            const role = this.builtinRole(preset);
            if (role === null || representatives.has(role)) continue;
            representatives.set(role, preset);
        }

        // 同じ品質に複数ある場合、指定 container 内で代表を選ぶ。未指定時は従来の優先順を使う。
        for (const role of representatives.keys()) {
            const candidates = presets.filter(preset => this.builtinRole(preset) === role);
            representatives.set(
                role,
                [...candidates].sort((a, b) =>
                    container === undefined || container === 'normal'
                        ? this.representativeScore(b) - this.representativeScore(a)
                        : 0,
                )[0],
            );
        }

        return presets
            .map((preset, index) => {
                const role = roles[index];
                const representative = role !== null && representatives.get(role) === preset;
                const builtin = representative;
                const builtinPreset = role === null ? undefined : BUILTIN_STREAM_PRESETS.find(item => item.id === role);
                const modePresetId = preset.id === 'auto' ? resolvedId : preset.id;
                const modes = Object.fromEntries(
                    (Object.keys(modeMap) as Array<keyof typeof modeMap>)
                        .map(container => [container, modeMap[container].indexOf(modePresetId)])
                        .filter(entry => Number(entry[1]) >= 0),
                ) as PlaybackOptions['profiles'][number]['modes'];
                return {
                    role,
                    profile: {
                        id: preset.id,
                        label: builtin && builtinPreset !== undefined ? builtinPreset.name : preset.name,
                        detail:
                            preset.id === 'auto'
                                ? autoReason
                                : (preset.detail ?? preset.description ?? this.technicalDetail(preset)),
                        available: true as const,
                        builtin,
                        legacy: preset.legacy === true,
                        modes,
                    },
                };
            })
            .sort((a, b) => this.profileDisplayOrder(a.role) - this.profileDisplayOrder(b.role))
            .map(item => item.profile);
    }

    private profileDisplayOrder(role: string | null): number {
        const order: Record<string, number> = {
            auto: 0,
            original: 1,
            '2160p-high': 2,
            '1080p-high': 3,
            '1080p': 4,
            '720p': 5,
            'data-saver': 6,
        };
        return order[role ?? ''] ?? 100;
    }

    private builtinRole(preset: StreamPreset): string | null {
        if (preset.id === 'auto') return 'auto';
        if (preset.id === 'original' || preset.name === 'オリジナル' || preset.output.codec === 'copy')
            return 'original';
        const resolution = preset.output.resolution;
        if (resolution === '2160p') return '2160p-high';
        if (resolution === '1080p') return preset.output.codec === 'hevc' ? '1080p-high' : '1080p';
        if (resolution === '720p') return '720p';
        if (resolution === '480p' || resolution === '240p') return 'data-saver';
        return null;
    }

    private representativeScore(preset: StreamPreset): number {
        return (
            ({ m2tsll: 50, hls: 40, m2ts: 30, mp4: 20, webm: 10 } as Record<string, number>)[
                preset.output.container ?? ''
            ] ?? 0
        );
    }

    private technicalDetail(preset: StreamPreset): string {
        const codec =
            preset.output.codec === 'h264' ? 'H.264' : preset.output.codec === 'hevc' ? 'HEVC' : preset.output.codec;
        const resolution = preset.output.resolution === 'source' ? 'source' : preset.output.resolution;
        const container =
            preset.output.container === 'm2tsll' ? 'MPEG-TS / 低遅延' : preset.output.container?.toUpperCase();
        return [codec, resolution, container].filter((value): value is string => value !== undefined).join(' / ');
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
