import * as apid from '../../../api';

export type PlaybackLabel = { name: string; summary: string; detail: string; badges: string[] };

// 一般ユーザー向けに「何が嬉しいか」で書いた説明。技術的な detail は別途 profile.detail / recommended.reason を使う
const LABELS: Record<string, Omit<PlaybackLabel, 'detail' | 'badges'>> = {
    auto: { name: 'おまかせ (自動)', summary: '端末と回線に合わせて自動で選びます' },
    original: { name: 'オリジナル', summary: '再エンコードなし。画質最高・通信量は最大' },
    '2160p-high': { name: '4K 高画質', summary: '4K・高画質。通信量は大きめ' },
    '1080p-high': { name: '1080p 高画質', summary: 'フル HD・高画質' },
    '1080p': { name: '1080p 標準', summary: 'フル HD・標準的な通信量' },
    '720p': { name: '720p', summary: '画質と通信量のバランス。モバイル向け' },
    'data-saver': { name: 'データ節約', summary: '通信量を最小に。画質は粗め' },
};

/**
 * ラベルの引き当てキー。
 * profile.id は `live-m2tsll-1080p-avc` のような実プリセット id なので、
 * サーバが返す role (auto / original / 1080p など) を優先して引く
 * @param profile: apid.PlaybackProfile
 * @return string
 */
const labelKey = (profile: apid.PlaybackProfile): string => profile.role ?? profile.id;

/**
 * 解像度らしき数値をラベル文字列から拾う (未知プリセットの summary 用フォールバック)
 * @param label: string
 * @return string | null
 */
const guessResolutionSummary = (label: string): string | null => {
    const match = label.match(/(\d{3,4})\s*p/i);
    return match === null ? null : `${match[1]}p 相当`;
};

/**
 * プリセット ID を通常表示用の日本語へ変換する純粋関数。
 * @param profile: apid.PlaybackProfile 対象プリセット
 * @param source: apid.SourceCapabilities | undefined 元映像の特性 (HDR 判定に使用)
 * @param recommended: apid.PlaybackOptions['recommended'] | undefined auto の「今回の選択」表示に使用
 * @return PlaybackLabel
 */
export const getPlaybackLabel = (
    profile: apid.PlaybackProfile,
    source?: apid.SourceCapabilities,
    recommended?: apid.PlaybackOptions['recommended'],
): PlaybackLabel => {
    const key = labelKey(profile);
    const known = LABELS[key];
    const isAuto = key === 'auto';

    const name = known?.name ?? profile.label;
    const summary = isAuto
        ? recommended !== undefined
            ? `今回の選択: ${recommended.label}`
            : (known?.summary ?? '')
        : (known?.summary ?? guessResolutionSummary(profile.label) ?? 'カスタムプリセット');
    const detail = isAuto ? (recommended?.reason ?? profile.detail) : profile.detail;

    const badges: string[] = [];
    if (isAuto) badges.push('おすすめ');
    if (key === '2160p-high') badges.push('4K');
    const isHdrPreserving = key === '2160p-high' || key === '1080p-high';
    if (isHdrPreserving && source?.hdr !== undefined && source.hdr !== 'sdr' && source.hdr !== 'unknown') badges.push('HDR');
    if (key === 'original') badges.push('変換なし');
    if (key === '720p' || key === 'data-saver') badges.push('通信量小');
    if (profile.builtin !== true) badges.push('カスタム');

    return { name, summary, detail, badges: badges.slice(0, 2) };
};

/**
 * ダイアログの画質トグルボタンなど、短い 1 行に収める必要がある箇所向けのラベルを返す。
 * auto のときは「今回選ばれた画質」も併記する
 * @param profile: apid.PlaybackProfile 選択中のプリセット
 * @param recommended: apid.PlaybackOptions['recommended'] | undefined サーバの推奨結果
 * @return string
 */
export const getPlaybackShortLabel = (profile: apid.PlaybackProfile, recommended?: apid.PlaybackOptions['recommended']): string => {
    if (labelKey(profile) === 'auto') {
        return recommended === undefined ? 'おまかせ (自動)' : `おまかせ (今回: ${recommended.label})`;
    }

    return LABELS[labelKey(profile)]?.name ?? profile.label;
};

export default { getPlaybackLabel, getPlaybackShortLabel };
