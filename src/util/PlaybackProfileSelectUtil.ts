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
