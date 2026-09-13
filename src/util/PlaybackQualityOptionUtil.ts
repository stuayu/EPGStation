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

export default { createPlaybackQualityOptions, disambiguatePlaybackLabels };
