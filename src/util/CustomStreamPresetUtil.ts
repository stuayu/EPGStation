import { StreamProfile } from '../model/IConfigFile';
import { StreamPreset } from '../model/stream/preset/IStreamPreset';

export interface CustomStreamPresetInput {
    id: string;
    name: string;
    useFor: StreamPreset['useFor'];
    container: StreamProfile['container'];
    output: StreamPreset['output'];
    customOptions?: StreamProfile['customOptions'];
    rawCommand?: string;
}

/** Built-in または上級者入力を実行用 StreamProfile へ変換する。 */
export const toStreamProfile = (input: CustomStreamPresetInput): StreamProfile => ({
    id: input.id,
    name: input.name,
    container: input.container,
    video:
        input.output.codec === 'copy'
            ? undefined
            : {
                  codec: input.output.codec === 'hevc' ? 'libx265' : 'libx264',
                  height:
                      input.output.resolution === 'source'
                          ? undefined
                          : Number.parseInt(input.output.resolution ?? '0', 10),
                  bitrate: input.output.videoBitrate,
              },
    cmd: input.rawCommand?.trim() || undefined,
    customOptions: input.customOptions,
    isUnconverted: input.output.codec === 'copy',
});

/** Built-in をカスタムプリセットの初期値へ複製する。 */
export const cloneBuiltinPreset = (preset: StreamPreset, id: string): CustomStreamPresetInput => ({
    id,
    name: preset.name,
    useFor: preset.useFor,
    container: preset.output.container ?? 'hls',
    output: { ...preset.output },
});
