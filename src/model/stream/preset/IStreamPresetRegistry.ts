import { ClientCapabilities } from '../capability/IClientCapabilities';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from './IStreamPreset';
import { StreamContainer } from '../../IConfigFile';

export type StreamPresetScope = 'live' | 'recorded-ts' | 'recorded-encoded';

export default interface IStreamPresetRegistry {
    getPresets(scope: StreamPresetScope, source: SourceCapabilities, client: ClientCapabilities): StreamPreset[];
    getModeMap(scope: StreamPresetScope): Record<StreamContainer, string[]>;
    resolveMode(scope: StreamPresetScope, container: StreamContainer, mode: number): string | null;
}
