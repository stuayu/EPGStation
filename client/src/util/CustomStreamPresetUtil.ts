import { ClientBuiltinPreset } from './BuiltinStreamPresets';

/** Built-in をカスタム入力へ複製する。 */
export const cloneBuiltinPreset = (preset: ClientBuiltinPreset, id: string) => ({
    id, name: preset.name, useFor: preset.useFor, container: preset.output.container ?? 'hls', output: { ...preset.output }, quality: preset.quality,
});
