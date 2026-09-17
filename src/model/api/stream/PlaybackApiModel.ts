import { inject, injectable, optional } from 'inversify';
import * as apid from '../../../../api';
import IVideoFileDB from '../../db/IVideoFileDB';
import IRecordedDB from '../../db/IRecordedDB';
import ISourceAnalyzer from '../../stream/capability/ISourceAnalyzer';
import IVideoUtil from '../video/IVideoUtil';
import IScheduleApiModel from '../schedule/IScheduleApiModel';
import AudioTrackUtil from '../../service/stream/util/AudioTrackUtil';
import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import IPlaybackPolicyResolver, { PlaybackPreference } from '../../stream/resolver/IPlaybackPolicyResolver';
import IStreamPresetRegistry, { StreamPresetScope } from '../../stream/preset/IStreamPresetRegistry';
import { StreamPreset } from '../../stream/preset/IStreamPreset';
import { BUILTIN_STREAM_PRESETS } from '../../../util/BuiltinStreamPresets';
import {
    classifyOriginalHevcAudioLayout,
    isOriginalHevcSource,
    ORIGINAL_HEVC_PROFILE_ID,
    OriginalHevcAudioLayout,
} from '../../../util/OriginalHevcUtil';
import IPlaybackApiModel, { PlaybackOptions } from './IPlaybackApiModel';

@injectable()
export default class PlaybackApiModel implements IPlaybackApiModel {
    constructor(
        @inject('ISourceAnalyzer') private readonly sourceAnalyzer: ISourceAnalyzer,
        @inject('IStreamPresetRegistry') private readonly presetRegistry: IStreamPresetRegistry,
        @inject('IPlaybackPolicyResolver') private readonly resolver: IPlaybackPolicyResolver,
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') @optional() private readonly recordedDB?: IRecordedDB,
        @inject('IVideoUtil') @optional() private readonly videoUtil?: IVideoUtil,
        @inject('IScheduleApiModel') @optional() private readonly scheduleApiModel?: IScheduleApiModel,
    ) {}

    public async getLivePlaybackOptions(
        channelId: apid.ChannelId,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
        preference?: PlaybackPreference,
    ): Promise<PlaybackOptions> {
        return this.create(
            'live',
            await this.sourceAnalyzer.analyzeLiveChannel(channelId),
            client,
            requestedPresetId,
            container,
            preference,
            true,
            undefined,
            await this.getLiveAudioStreamCount(channelId),
        );
    }

    public async getRecordedPlaybackOptions(
        videoFileId: apid.VideoFileId,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
        preference?: PlaybackPreference,
    ): Promise<PlaybackOptions> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');
        const scope: StreamPresetScope = video.type === 'encoded' ? 'recorded-encoded' : 'recorded-ts';
        const recorded = this.recordedDB === undefined ? null : await this.recordedDB.findId(video.recordedId);
        const source = await this.sourceAnalyzer.analyzeRecordedFile(videoFileId);
        return this.create(
            scope,
            source,
            client,
            requestedPresetId,
            container,
            preference,
            recorded?.isRecording !== true,
            await this.getOriginalHevcAudioLayout(videoFileId, video.type === 'encoded', source),
            await this.getRecordedAudioStreamCount(videoFileId),
        );
    }

    private create(
        scope: StreamPresetScope,
        source: apid.SourceCapabilities,
        client: ClientCapabilities,
        requestedPresetId?: string,
        container?: apid.PlaybackContainer,
        preference?: PlaybackPreference,
        allowOriginal = true,
        originalHevcAudioLayout?: OriginalHevcAudioLayout,
        audioStreamCount?: number,
    ): PlaybackOptions {
        const allPresets = this.presetRegistry.getPresets(scope, source, client);
        const modeMap =
            typeof this.presetRegistry.getModeMap === 'function'
                ? this.presetRegistry.getModeMap(scope)
                : { m2ts: [], m2tsll: [], mp4: [], webm: [], hls: [] };
        const presets =
            container === undefined || container === 'normal'
                ? allPresets
                : container === 'original'
                  ? allPresets.filter(
                        preset =>
                            preset.id === 'auto' ||
                            (allowOriginal && preset.delivery === 'mpeg2toh264') ||
                            (allowOriginal && preset.id === ORIGINAL_HEVC_PROFILE_ID),
                    )
                  : allPresets.filter(
                        preset =>
                            preset.id === 'auto' ||
                            (allowOriginal && preset.delivery === 'mpeg2toh264') ||
                            (allowOriginal && preset.id === ORIGINAL_HEVC_PROFILE_ID) ||
                            modeMap[container]?.includes(preset.id) === true,
                    );
        const decision = this.resolver.resolve(scope, source, client, presets, requestedPresetId, preference);
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
                originalHevcAudioLayout,
                audioStreamCount,
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
        originalHevcAudioLayout?: OriginalHevcAudioLayout,
        audioStreamCount?: number,
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
                // `original` は MPEG-2 の端末変換と HEVC の元 TS MSE 配信をまとめた方式。
                // HEVC が非対応の端末ではクライアントが hls mode へフォールバックする。
                if (preset.delivery === 'mpeg2toh264' || preset.id === ORIGINAL_HEVC_PROFILE_ID) modes.original = 0;
                if (preset.id === ORIGINAL_HEVC_PROFILE_ID) modes.hls = 0;
                return {
                    role,
                    profile: {
                        id: preset.id,
                        role,
                        label: builtin && builtinPreset !== undefined ? builtinPreset.name : preset.name,
                        detail:
                            preset.id === 'auto'
                                ? autoReason
                                : (preset.detail ?? preset.description ?? this.technicalDetail(preset)),
                        available: true as const,
                        builtin,
                        legacy: preset.legacy === true,
                        modes,
                        videoBitrate: preset.output.videoBitrate,
                        videoCodec: preset.output.codec,
                        delivery: (preset.delivery ?? 'stream') as 'stream' | 'mpeg2toh264',
                        embeddedAudioSwitch: this.getEmbeddedAudioSwitch(
                            scope,
                            modes,
                            modePresetId,
                            originalHevcAudioLayout,
                            audioStreamCount,
                        ),
                    },
                };
            })
            .sort((a, b) => this.profileDisplayOrder(a.role) - this.profileDisplayOrder(b.role))
            .map(item => item.profile);
    }

    /**
     * コンテナ別に「主音声・副音声を再接続無しで同時配信できるか」を判定する
     *
     * - m2tsll: 実プロファイルの cmd が `%TSREADEX%` と音声選択用プレースホルダを両方含む場合、または
     *   tsreadex 無しでも実音声 ES が 2 本以上あり音声選択用プレースホルダを含む場合に true になる
     *   (デュアルモノラルの 1 ES では `-map` 分離できないため false)。
     *   クライアントはこれが true のときだけ `audioTrack=all` で開き、mpegts.js の
     *   switchPrimaryAudio() / switchSecondaryAudio() で再接続無しに音声を切り替える
     *   (client/src/components/video/LiveMpegTsVideo.vue)。
     * - original: 対応端末の encoded `original-hevc`。元TSを直接配信し、mpegts.js または Web Audio API が切り替える
     * - hls: encoded の `original-hevc` fallback、または音声選択用プレースホルダを含み、tsreadex 済みまたは
     *   実音声 ES が 2 本以上で、かつ in-memory HLS (cmd に `%streamFileDir%` を含まない) の場合に true になる。
     *   Fmp4Packager が音声トラック 2 本以上の fMP4 を検出すると自動でトラックごとに分解し、
     *   マスタープレイリスト (音声レンディション付き) を配信する (HLSMemoryStoreModel.getMasterPlaylist())。
     *   ディスク方式の HLS (`%streamFileDir%` を含む cmd) は Fmp4Packager を経由しないため対象外
     * @param scope: StreamPresetScope
     * @param modes: PlaybackOptions['profiles'][number]['modes']
     * @param modePresetId: string このプロファイルが実際に紐づく (auto 解決済みの) プリセット id
     * @return PlaybackOptions['profiles'][number]['embeddedAudioSwitch']
     */
    private getEmbeddedAudioSwitch(
        scope: StreamPresetScope,
        modes: PlaybackOptions['profiles'][number]['modes'],
        modePresetId: string,
        originalHevcAudioLayout?: OriginalHevcAudioLayout,
        audioStreamCount?: number,
    ): PlaybackOptions['profiles'][number]['embeddedAudioSwitch'] {
        const containers = Object.keys(modes) as Array<keyof typeof modes>;
        if (containers.length === 0) {
            return undefined;
        }

        const cmd =
            typeof this.presetRegistry.resolveProfileCmd === 'function'
                ? this.presetRegistry.resolveProfileCmd(scope, modePresetId)
                : undefined;
        const hasTsreadexAudioMap = typeof cmd === 'string' && cmd.includes('%TSREADEX%') && cmd.includes('%AUDIOMAP%');
        const hasTsreadexAudioSelectMap =
            typeof cmd === 'string' && cmd.includes('%TSREADEX%') && cmd.includes('%AUDIOSELECTMAP%');
        const hasAudioMapPlaceholder = typeof cmd === 'string' && cmd.includes('%AUDIOMAP%');
        const hasAudioSelectMapPlaceholder = typeof cmd === 'string' && cmd.includes('%AUDIOSELECTMAP%');
        const hasAudioMap = hasAudioMapPlaceholder || hasAudioSelectMapPlaceholder;
        const isM2TsLLEmbedded =
            hasTsreadexAudioMap || hasTsreadexAudioSelectMap || (hasAudioMap && (audioStreamCount ?? 0) >= 2);
        // in-memory HLS (%streamFileDir% を含まない) だけが Fmp4Packager 経由で複数音声トラックを配信できる
        const isOriginalHevcEmbedded =
            modePresetId === ORIGINAL_HEVC_PROFILE_ID &&
            scope !== 'live' &&
            (originalHevcAudioLayout === 'dual-mono' || originalHevcAudioLayout === 'multi');
        const hasMultipleAudioStreams =
            hasTsreadexAudioMap || hasTsreadexAudioSelectMap || (audioStreamCount ?? 0) >= 2;
        const isHlsEmbedded =
            isOriginalHevcEmbedded ||
            (hasAudioMap &&
                hasMultipleAudioStreams &&
                typeof cmd === 'string' &&
                cmd.includes('%streamFileDir%') === false);

        const result: NonNullable<PlaybackOptions['profiles'][number]['embeddedAudioSwitch']> = {};
        for (const container of containers) {
            result[container] =
                (container === 'm2tsll' && isM2TsLLEmbedded) ||
                ((container === 'hls' || container === 'original') && isHlsEmbedded);
        }

        return result;
    }

    /** 番組情報からライブ配信の実音声 ES 数を求める。取得失敗時は未指定にする。 */
    private async getLiveAudioStreamCount(channelId: apid.ChannelId): Promise<number | undefined> {
        if (this.scheduleApiModel === undefined) return undefined;

        try {
            return AudioTrackUtil.getAudioStreamCount(await this.scheduleApiModel.getLiveAudioTracks(channelId));
        } catch (_err: unknown) {
            return undefined;
        }
    }

    /** 録画ファイルの実音声 ES 数を有限 probe する。probe 失敗時は未指定にする。 */
    private async getRecordedAudioStreamCount(videoFileId: apid.VideoFileId): Promise<number | undefined> {
        if (this.videoUtil === undefined) return undefined;

        try {
            const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
            if (filePath === null) return undefined;

            return AudioTrackUtil.getAudioStreamCount(await this.videoUtil.getAudioTracks(filePath));
        } catch (_err: unknown) {
            return undefined;
        }
    }

    /** encoded HEVC の実 AAC 構成を取得する。未知・失敗時は音声切替を無効にする。 */
    private async getOriginalHevcAudioLayout(
        videoFileId: apid.VideoFileId,
        isEncoded: boolean,
        source: apid.SourceCapabilities,
    ): Promise<OriginalHevcAudioLayout | undefined> {
        if (isEncoded === false || isOriginalHevcSource(source) === false || this.videoUtil === undefined) {
            return undefined;
        }

        try {
            const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
            if (filePath === null) return undefined;

            const tracks = await this.videoUtil.getAudioTracks(filePath);
            const layout = classifyOriginalHevcAudioLayout(tracks);
            // StreamApiModel と同じく、2 本目の音声 ES がファイル全体に無ければ 1 本として扱う
            if (layout === 'multi' && (await this.videoUtil.hasStableSecondAudioStream(filePath)) === false)
                return 'single';
            return layout;
        } catch (_error) {
            return undefined;
        }

        return undefined;
    }

    private profileDisplayOrder(role: string | null): number {
        const order: Record<string, number> = {
            auto: 0,
            original: 1,
            'original-mpeg2': 2,
            'original-hevc': 3,
            '2160p-high': 4,
            '1080p-high': 5,
            '1080p': 6,
            '720p': 7,
            'data-saver': 8,
        };
        return order[role ?? ''] ?? 100;
    }

    private builtinRole(preset: StreamPreset): string | null {
        if (preset.id === 'auto') return 'auto';
        if (preset.delivery === 'mpeg2toh264') return 'original-mpeg2';
        if (preset.id === ORIGINAL_HEVC_PROFILE_ID) return 'original-hevc';
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
