import { injectable } from 'inversify';
import {
    buildFfmpegVideoArgs,
    buildRigayaVideoArgs,
    selectEncoder,
    StreamEncoderCapability,
} from '../../../util/StreamArgsUtil';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import IRecordedCommandBuilder from './IRecordedCommandBuilder';

@injectable()
export default class RecordedCommandBuilder implements IRecordedCommandBuilder {
    /** 録画ファイル入力用の品質優先配信コマンドを組み立てる。 */
    public build(
        source: SourceCapabilities,
        preset: StreamPreset,
        encoders: readonly StreamEncoderCapability[],
    ): string {
        if (preset.output.codec === 'copy') return '%FFMPEG% -ss %SS% -i %INPUT% -c copy -tag:v hvc1 -f mpegts pipe:1';
        const encoder = selectEncoder(source, preset, encoders);
        if (encoder.kind === 'ffmpeg') {
            return `%FFMPEG% -ss %SS% -i %INPUT% ${buildFfmpegVideoArgs(source, preset, 'recorded')} -f mpegts pipe:1`;
        }
        const bin =
            (encoder.command ?? encoder.kind === 'nvencc')
                ? 'NVEncC'
                : encoder.kind === 'qsvencc'
                  ? 'QSVEncC'
                  : 'VCEEncC';
        return `${bin} --seek %SS% -i %INPUT% ${buildRigayaVideoArgs(source, preset, encoder, 'recorded', true)} -o - | %FFMPEG% -i pipe:0 -c copy${source.codec === 'hevc' ? ' -tag:v hvc1' : ''} -f mpegts pipe:1`;
    }
}
