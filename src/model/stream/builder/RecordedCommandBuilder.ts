import { injectable } from 'inversify';
import {
    buildFfmpegAudioArgs,
    buildFfmpegVideoArgs,
    buildRigayaVideoArgs,
    selectEncoder,
    StreamEncoderCapability,
} from '../../../util/StreamArgsUtil';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import IRecordedCommandBuilder from './IRecordedCommandBuilder';

/**
 * 録画ファイル入力用の配信コマンドを組み立てる
 *
 * 音声トラックの切り替えは %DUALMONOMODE% / %AUDIOMAP% / %AUDIOFILTER% を埋め込んでおき、
 * 配信直前に AudioTrackUtil.replacePlaceholders() で展開する (直接 -dual_mono_mode を書かない)
 */
@injectable()
export default class RecordedCommandBuilder implements IRecordedCommandBuilder {
    /** 録画ファイル入力用の品質優先配信コマンドを組み立てる。 */
    public build(
        source: SourceCapabilities,
        preset: StreamPreset,
        encoders: readonly StreamEncoderCapability[],
    ): string {
        if (preset.output.codec === 'copy') {
            return '%FFMPEG% %DUALMONOMODE% -ss %SS% -i %INPUT% -c copy -tag:v hvc1 -f mpegts pipe:1';
        }

        const audio = buildFfmpegAudioArgs(preset);
        const encoder = selectEncoder(source, preset, encoders);
        if (encoder.kind === 'ffmpeg') {
            return (
                `%FFMPEG% %DUALMONOMODE% -ss %SS% -i %INPUT% -sn ${audio} ` +
                `${buildFfmpegVideoArgs(source, preset, 'recorded')} -f mpegts pipe:1`
            );
        }

        const bin =
            (encoder.command ?? encoder.kind === 'nvencc')
                ? 'NVEncC'
                : encoder.kind === 'qsvencc'
                  ? 'QSVEncC'
                  : 'VCEEncC';

        // rigaya 系は音声をコピーのまま mpegts で流し、後段の ffmpeg で aac 化する
        // (--audio-filter は --audio-copy と併用できないため、音声の加工は後段へ寄せる)
        return (
            `${bin} --seek %SS% -i %INPUT% ${buildRigayaVideoArgs(source, preset, encoder, 'recorded', true)} ` +
            `--audio-copy --output-format mpegts -o - | ` +
            `%FFMPEG% %DUALMONOMODE% -i pipe:0 -sn -c:v copy${source.codec === 'hevc' ? ' -tag:v hvc1' : ''} ` +
            `${audio} -f mpegts pipe:1`
        );
    }
}
