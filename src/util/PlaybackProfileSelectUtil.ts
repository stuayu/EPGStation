import * as apid from '../../api';

// ブラウザーからも利用するため、child_process を含む OriginalHevcUtil は import しない。
const ORIGINAL_HEVC_PROFILE_ID = 'original-hevc';

/** 配信選択ダイアログから視聴画面へ渡す profile を決めるための最小限の型 */
export interface SelectablePlaybackProfile {
    id: string;
    modes: { [container: string]: number | undefined };
}

/**
 * 視聴画面へ渡す profile id を決める。
 * mode の番号は配信方式ごとの並び順でしかなく、「おまかせ」やオリジナル (HEVC 無変換) など
 * 複数のプロファイルが同じ番号を持つ。番号から先頭一致で逆引きすると、利用者が選んだ画質ではなく
 * 別のプロファイル (例: オリジナル HEVC を選んだのに auto → 1080p 再エンコード) で再生される。
 * そのため選択中のプロファイルがその mode を持つときだけその id を返し、それ以外は profile を渡さない。
 * @param profiles: SelectablePlaybackProfile[] ダイアログに出している画質一覧
 * @param selectedId: string | null | undefined 選択中のプロファイル id
 * @param container: string 配信方式
 * @param mode: number 配信設定の mode
 * @return string | undefined
 */
export const resolveSelectedPlaybackProfileId = (
    profiles: SelectablePlaybackProfile[],
    selectedId: string | null | undefined,
    container: string,
    mode: number,
): string | undefined => {
    const selected = profiles.find(profile => profile.id === selectedId);
    if (selected !== undefined && selected.modes[container] === mode) return selected.id;

    // 選択と mode が食い違う (配信設定を手で変えた等) ときは profile を渡さない。
    // サーバは mode を config の配信設定の並びで解決するので、HEAD までと同じ挙動になる
    return undefined;
};

export type ResolvedPlaybackSelection = {
    streamingType: Exclude<apid.PlaybackContainer, 'normal'>;
    mode: number;
    profile?: string;
};

/**
 * 配信選択ダイアログの方式・画質選択を視聴画面の URL パラメータへ変換する。
 * Original は素材によって API の実体が異なり、HEVC は HLS profile として再生する。
 * mode 番号だけで profile を逆引きしないため、選択中 profile と mode の一致も確認する。
 * @param profiles: SelectablePlaybackProfile[] ダイアログに出している画質一覧
 * @param selectedId: string | null | undefined 選択中の profile id
 * @param container: Exclude<apid.PlaybackContainer, 'normal'> 選択中の配信方式
 * @param mode: number 選択中の配信方式の mode
 * @return ResolvedPlaybackSelection 視聴画面へ渡す方式・mode・profile
 */
export const resolvePlaybackSelection = (
    profiles: SelectablePlaybackProfile[],
    selectedId: string | null | undefined,
    container: Exclude<apid.PlaybackContainer, 'normal'>,
    mode: number,
): ResolvedPlaybackSelection => {
    const profileId = resolveSelectedPlaybackProfileId(profiles, selectedId, container, mode);
    const selected = profiles.find(profile => profile.id === profileId);

    if (container === 'original' && selected?.id === ORIGINAL_HEVC_PROFILE_ID) {
        const hlsMode = selected.modes.hls;
        if (typeof hlsMode === 'number') return { streamingType: 'hls', mode: hlsMode, profile: selected.id };
    }

    return { streamingType: container, mode, ...(profileId === undefined ? {} : { profile: profileId }) };
};

/** DPlayer の方式切替要求を、profile の実体に合う録画方式へ正規化する。 */
export const resolvePlaybackContainer = (
    container: Exclude<apid.PlaybackContainer, 'normal'>,
    profileId?: string,
): Exclude<apid.PlaybackContainer, 'normal'> =>
    container === 'original' && profileId === ORIGINAL_HEVC_PROFILE_ID ? 'hls' : container;
