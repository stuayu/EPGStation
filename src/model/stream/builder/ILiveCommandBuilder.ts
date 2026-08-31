import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import { StreamEncoderCapability } from '../../../util/StreamArgsUtil';

export default interface ILiveCommandBuilder {
    build(source: SourceCapabilities, preset: StreamPreset, encoders: readonly StreamEncoderCapability[]): string;
}
