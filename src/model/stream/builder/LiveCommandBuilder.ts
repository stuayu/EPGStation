import { inject, injectable, optional } from 'inversify';
import {
    buildFfmpegAudioArgs,
    buildFfmpegVideoArgs,
    buildRigayaVideoArgs,
    selectEncoder,
    StreamEncoderCapability,
} from '../../../util/StreamArgsUtil';
import { SourceCapabilities } from '../capability/ISourceCapabilities';
import { StreamPreset } from '../preset/IStreamPreset';
import ILiveCommandBuilder from './ILiveCommandBuilder';
import IHardwareEncoderDetector from '../../encoder/IHardwareEncoderDetector';

/**
 * ライブ入力 (Mirakurun の TS) 用の配信コマンドを組み立てる
 *
 * 音声トラックの切り替えは %DUALMONOMODE% / %AUDIOMAP% / %AUDIOFILTER% を埋め込んでおき、
 * 配信直前に AudioTrackUtil.replacePlaceholders() で展開する (直接 -dual_mono_mode を書かない)。
 * 字幕・データ放送 (ARIB 字幕 / BML) は -map 0 + -c:s copy -c:d copy でそのまま通す
 */
@injectable()
export default class LiveCommandBuilder implements ILiveCommandBuilder {
    constructor(@inject('IHardwareEncoderDetector') @optional() private readonly detector?: IHardwareEncoderDetector) {}

    /** ライブ入力用の低遅延配信コマンドを組み立てる。 */
    public build(
        source: SourceCapabilities,
        preset: StreamPreset,
        encoders: readonly StreamEncoderCapability[] = [],
    ): string {
        if (preset.output.codec === 'copy') {
            return '%FFMPEG% %DUALMONOMODE% -i pipe:0 -map 0 -c copy -ignore_unknown -f mpegts pipe:1';
        }

        const audio = buildFfmpegAudioArgs(preset);
        const rigayaAudio = audio.replace('%AUDIOMAP% ', '');
        const available =
            encoders.length > 0
                ? encoders
                : [
                      this.detector?.getStreamEncoder(preset.output.codec ?? 'h264') ?? {
                          kind: 'ffmpeg',
                          codecs: ['h264', 'hevc'],
                          bitDepths: [8, 10],
                      },
                  ];
        const encoder = selectEncoder(source, preset, available);
        if (encoder.kind === 'ffmpeg') {
            return (
                `%FFMPEG% %DUALMONOMODE% -f mpegts -analyzeduration 500000 -probesize 500000 -fflags nobuffer -i pipe:0 ` +
                `-map 0 -c:s copy -c:d copy -flags low_delay -ignore_unknown -max_delay 250000 -max_interleave_delta 1 -threads 0 ` +
                `${audio} ${buildFfmpegVideoArgs(source, preset, 'live', encoder)} -f mpegts pipe:1`
            );
        }

        const bin =
            encoder.command ??
            (encoder.kind === 'nvencc' ? 'NVEncC' : encoder.kind === 'qsvencc' ? 'QSVEncC' : 'VCEEncC');

        // rigaya 系は音声をコピーのまま mpegts で流し、後段の ffmpeg で aac 化する
        // (--audio-filter は --audio-copy と併用できないため、音声の加工は後段へ寄せる)
        return (
            `${bin} --input-format mpegts -i - ${buildRigayaVideoArgs(source, preset, encoder, 'live', false)} ` +
            `--audio-copy --output-format mpegts -o - | ` +
            `%FFMPEG% %DUALMONOMODE% -f mpegts -analyzeduration 500000 -probesize 500000 -fflags nobuffer -i pipe:0 ` +
            `-map 0 -c:v copy -c:s copy -c:d copy -flags low_delay -ignore_unknown -max_interleave_delta 1 ${rigayaAudio} -f mpegts pipe:1`
        );
    }
}
