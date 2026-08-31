import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import { PlaybackDecision } from './IPlaybackDecision';

export type PlaybackPresetScope = 'live' | 'recorded-ts' | 'recorded-encoded';

export default interface IPlaybackPolicyResolver {
    /** 入力・端末・候補プリセットから再生方式を決定する。 */
    resolve(
        scope: PlaybackPresetScope,
        source: SourceCapabilities,
        client: ClientCapabilities,
        presets: StreamPreset[],
        requestedPresetId?: string,
    ): PlaybackDecision;
}
