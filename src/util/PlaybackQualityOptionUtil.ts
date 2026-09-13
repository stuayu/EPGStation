import * as apid from '../../api';

export type SelectablePlaybackContainer = Exclude<apid.PlaybackContainer, 'm2ts' | 'normal'>;

export interface PlaybackQualityOption {
    profile: apid.PlaybackProfile;
    container: SelectablePlaybackContainer;
    mode: number;
}

export interface PlaybackQualityOptionResult {
    options: PlaybackQualityOption[];
    currentIndex: number;
}

const CONTAINER_ORDER: readonly SelectablePlaybackContainer[] = ['hls', 'm2tsll', 'mp4', 'webm'];

/**
 * playback-options の profile と container 別 mode から、DPlayer 用の選択肢を作る。
 * @param profiles API が返した再生プロファイル
 * @param containers 画面が切替可能な配信方式
 * @param currentContainer 現在の配信方式
 * @param currentMode 現在の配信方式における mode
 * @param selectedId 現在選択中の profile id
 * @return DPlayer 用の組み合わせ一覧と現在位置
 */
export const createPlaybackQualityOptions = (
    profiles: apid.PlaybackProfile[],
    containers: SelectablePlaybackContainer[],
    currentContainer: SelectablePlaybackContainer,
    currentMode: number,
    selectedId = 'auto',
): PlaybackQualityOptionResult => {
    const orderedContainers = CONTAINER_ORDER.filter(container => containers.includes(container));
    const options = orderedContainers.flatMap(container =>
        profiles.flatMap(profile => {
            const mode = profile.modes?.[container];
            return typeof mode === 'number' ? [{ profile, container, mode }] : [];
        }),
    );

    const currentIndex = options.findIndex(option => option.container === currentContainer && option.mode === currentMode);
    if (currentIndex >= 0) return { options, currentIndex };

    const selectedIndex = options.findIndex(option => option.profile.id === selectedId && option.container === currentContainer);
    if (selectedIndex >= 0) return { options, currentIndex: selectedIndex };

    const anySelectedIndex = options.findIndex(option => option.profile.id === selectedId);

    return { options, currentIndex: anySelectedIndex >= 0 ? anySelectedIndex : 0 };
};

const CODEC_LABELS: Readonly<Record<string, string>> = { hevc: 'HEVC', h264: 'H.264', copy: '無変換' };

/**
 * 同じ表示名になる選択肢へコーデック名を足して区別できるようにする。
 * 本番のように「M2TS-LL 720p の HEVC 版と AVC 版」を両方持つ構成だと、
 * role が同じため素のラベルが完全に一致し、どちらを選んでいるか分からなくなる。
 * @param labels 素の表示名 (options と同じ並び)
 * @param profiles 対応する再生プロファイル (videoCodec を見る)
 * @return 重複したものだけコーデック名を付けた表示名
 */
export const disambiguatePlaybackLabels = (labels: string[], profiles: Array<{ videoCodec?: string }>): string[] => {
    const counts = new Map<string, number>();
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

    return labels.map((label, index) => {
        if ((counts.get(label) ?? 0) < 2) return label;
        const codec = profiles[index]?.videoCodec;
        const codecLabel = typeof codec === 'string' ? CODEC_LABELS[codec] : undefined;

        return typeof codecLabel === 'string' ? `${label} (${codecLabel})` : label;
    });
};

/** DPlayer のコントローラと設定メニューの余白 (px)。この分はパネルへ割り当てない */
const QUALITY_PANEL_RESERVED_PX = 66;
/** これ以上は縮めない高さ (px)。プレイヤーが極端に低いときでも数項目はスクロールで辿れるようにする */
const QUALITY_PANEL_MIN_PX = 120;

/**
 * 画質メニューの高さ上限を求める。
 * DPlayer の設定パネルはコントローラから上へ開くため、
 * ビューポート基準の上限だけだと**プレイヤーより高いパネル**が画面の上へはみ出し、
 * 上の方の項目がクリックできなくなる (実測: iPhone 14 Pro 393x660 でプレイヤー高 217px、
 * パネル高 294px、上端 y=-131 となり 8 件中 3 件が画面外)。
 * @param playerHeight プレイヤー (`.dplayer`) の高さ (px)
 * @param viewportHeight ビューポートの高さ (px)
 * @return パネルへ与える max-height (px)
 */
export const resolveQualityPanelMaxHeight = (playerHeight: number, viewportHeight: number): number => {
    const byViewport = viewportHeight > 0 ? viewportHeight * 0.7 : Number.POSITIVE_INFINITY;
    const byPlayer = playerHeight > 0 ? playerHeight - QUALITY_PANEL_RESERVED_PX : Number.POSITIVE_INFINITY;
    const limit = Math.min(byViewport, byPlayer, 420);

    return Number.isFinite(limit) === false ? 420 : Math.max(Math.floor(limit), QUALITY_PANEL_MIN_PX);
};

export default { createPlaybackQualityOptions, disambiguatePlaybackLabels, resolveQualityPanelMaxHeight };
