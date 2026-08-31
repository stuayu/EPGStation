export interface ClientBuiltinPreset {
    id: string;
    name: string;
    useFor: 'live' | 'recorded' | 'both';
    quality: string;
    output: { codec?: string; resolution?: string; bitDepth?: string | number; frameRate?: string; hdrMode?: string; videoCorrection?: string; container?: 'm2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls' };
}

/** カスタムプリセット複製 UI 用の Built-in 定義。実行時の正本はサーバ側。 */
export const BUILTIN_STREAM_PRESETS: readonly ClientBuiltinPreset[] = [
    { id: 'auto', name: '自動・おすすめ', useFor: 'both', quality: 'highest', output: { codec: 'copy', resolution: 'source', bitDepth: 'source', hdrMode: 'preserve' } },
    { id: 'original', name: 'オリジナル', useFor: 'both', quality: 'original', output: { codec: 'copy', resolution: 'source', bitDepth: 'source', frameRate: 'source', hdrMode: 'preserve' } },
    { id: '2160p-high', name: '4K 高画質', useFor: 'both', quality: 'highest', output: { codec: 'hevc', resolution: '2160p', bitDepth: 10, frameRate: 'source', hdrMode: 'preserve' } },
    { id: '1080p-high', name: '1080p 高画質', useFor: 'both', quality: 'high', output: { codec: 'hevc', resolution: '1080p', bitDepth: 'source', hdrMode: 'sdr' } },
    { id: '1080p', name: '1080p 標準', useFor: 'both', quality: 'balanced', output: { codec: 'h264', resolution: '1080p', bitDepth: 8, hdrMode: 'sdr' } },
    { id: '720p', name: '720p', useFor: 'both', quality: 'balanced', output: { codec: 'h264', resolution: '720p', bitDepth: 8, hdrMode: 'sdr' } },
    { id: 'data-saver', name: 'データ節約', useFor: 'both', quality: 'compact', output: { codec: 'h264', resolution: '480p', bitDepth: 8, hdrMode: 'sdr' } },
];
