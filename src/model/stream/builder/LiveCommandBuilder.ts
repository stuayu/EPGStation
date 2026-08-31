import { injectable } from 'inversify';
import {
    buildFfmpegVideoArgs,
    buildRigayaVideoArgs,
    selectEncoder,
    StreamEncoderCapability,
} from '../../../util/StreamArgsUtil';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import ILiveCommandBuilder from './ILiveCommandBuilder';

@injectable()
export default class LiveCommandBuilder implements ILiveCommandBuilder {
    /** ライブ入力用の低遅延配信コマンドを組み立てる。 */
    public build(
        source: SourceCapabilities,
        preset: StreamPreset,
        encoders: readonly StreamEncoderCapability[],
    ): string {
        if (preset.output.codec === 'copy') return '%FFMPEG% -i pipe:0 -c copy -f mpegts pipe:1';
        const encoder = selectEncoder(source, preset, encoders);
        if (encoder.kind === 'ffmpeg') {
            return `%FFMPEG% -i pipe:0 ${buildFfmpegVideoArgs(source, preset, 'live')} -f mpegts pipe:1`;
        }
        const bin =
            (encoder.command ?? encoder.kind === 'nvencc')
                ? 'NVEncC'
                : encoder.kind === 'qsvencc'
                  ? 'QSVEncC'
                  : 'VCEEncC';
        return `${bin} --input-format mpegts -i - ${buildRigayaVideoArgs(source, preset, encoder, 'live', false)} -o - | %FFMPEG% -i pipe:0 -c copy -f mpegts pipe:1`;
    }
}
