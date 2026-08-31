import * as apid from '../../../api';

export type PlaybackLabel = { name: string; summary: string; detail: string; badges: string[] };

const LABELS: Record<string, Omit<PlaybackLabel, 'detail' | 'badges'>> = {
    auto: { name: '自動・おすすめ', summary: '' },
    original: { name: 'オリジナル', summary: '再エンコードなし・最高画質' },
    '2160p-high': { name: '4K 高画質', summary: '4K HDR・高画質' },
    '1080p-high': { name: '1080p 高画質', summary: 'フル HD・高画質' },
    '1080p': { name: '1080p 標準', summary: 'フル HD・標準画質' },
    '720p': { name: '720p', summary: '通信量ひかえめ' },
    'data-saver': { name: 'データ節約', summary: '通信量最小' },
};

/** プリセット ID を通常表示用の日本語へ変換する純粋関数。 */
export const getPlaybackLabel = (profile: apid.PlaybackProfile, source?: apid.SourceCapabilities): PlaybackLabel => {
    const base = LABELS[profile.id] ?? { name: profile.label, summary: '再生用プリセット' };
    const badges: string[] = [];
    if (profile.id === 'auto') badges.push('おすすめ');
    if (profile.id === '2160p-high') badges.push('4K');
    if (profile.id === '2160p-high' && source?.hdr !== 'sdr') badges.push('HDR');
    if (badges.length < 2 && profile.id === '1080p-high' && source?.hdr !== 'sdr') badges.push('HDR');
    return { ...base, detail: profile.detail, badges: badges.slice(0, 2) };
};

export const getAutoReasonLabel = (reason: string): string => reason;

export default { getPlaybackLabel, getAutoReasonLabel };
