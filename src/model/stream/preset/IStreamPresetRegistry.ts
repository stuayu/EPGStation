import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from './IStreamPreset';
import { StreamContainer } from '../../IConfigFile';

export type StreamPresetScope = 'live' | 'recorded-ts' | 'recorded-encoded';

export default interface IStreamPresetRegistry {
    getPresets(scope: StreamPresetScope, source: SourceCapabilities, client: ClientCapabilities): StreamPreset[];
    getModeMap(scope: StreamPresetScope): Record<StreamContainer, string[]>;
    resolveMode(scope: StreamPresetScope, container: StreamContainer, mode: number): string | null;
    // 指定したプリセット id の実際の配信コマンド (cmd 省略時は生成後の cmd) を返す。
    // config 由来・EncodePresets 生成のどちらにも無ければ undefined (BUILTIN_STREAM_PRESETS 等 cmd を持たないもの)
    resolveProfileCmd(scope: StreamPresetScope, presetId: string): string | undefined;
}
