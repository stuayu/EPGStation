export type AudioTrackSwitchAction = 'noop' | 'embedded' | 'reconnect';

export type OfflineAudioTrackSwitchAction = 'noop' | 'dual-mono' | 'reload';

/**
 * 音声トラック切替の経路を決める。
 * @param current 現在の音声トラック指定子
 * @param next 切替先の音声トラック指定子
 * @param embeddedAudioSwitch 同一ストリーム内で音声を切り替えられるか
 * @return 音声切替の経路
 */
export const decideAudioTrackSwitch = (
    current: string,
    next: string,
    embeddedAudioSwitch: boolean,
): AudioTrackSwitchAction => {
    if (current === next) {
        return 'noop';
    }

    return embeddedAudioSwitch === true ? 'embedded' : 'reconnect';
};

/** オフライン original-hevc の音声切替経路を決める。 */
export const decideOfflineAudioTrackSwitch = (
    current: string,
    next: string,
    isDualMono: boolean,
): OfflineAudioTrackSwitchAction => {
    if (current === next) return 'noop';
    return isDualMono === true ? 'dual-mono' : 'reload';
};

/**
 * 音声切替が「再接続 (ストリームの作り直し)」経路を通った直後、音声レンディションの
 * 選び直しが必要かを返す。
 *
 * **判定はクライアントが持つ `embeddedAudioSwitch` フラグではなく、新しいストリームが
 * 実際に持っている音声レンディション数で行う** (Issue #31)。フラグは playback-options の
 * 非同期取得に依存するため、取得前 (未取得 = false 扱い) に音声切替が再接続へ落ちることがある。
 * 一方サーバーは tsreadex 正規化済みなら `audioTrack` の値に関係なく主・副 2 本の ES を
 * map する (`src/model/service/stream/util/AudioTrackUtil.ts`) ため、フラグが false でも
 * 新しいストリームは 2 レンディションで開いていることがあり、フラグだけで判定すると
 * 「サーバーは 2 レンディションを返しているのに選び直さない」食い違いが起きる
 * (報告された「主音声に切り替えてからもう一度副音声を選ぶと効く」症状の実際の原因)。
 *
 * 真理値表 (audioRenditionCount / isSecondaryTrackSelected → 結果):
 * - 2 本以上 / 副音声 → true (新ストリームは主音声レンディションから始まるため、
 *   選び直さないと主音声が鳴り続ける)
 * - 1 本 / 副音声 → false (`resolveStreamAudioTrack()` は embeddedAudioSwitch が
 *   不明・false のときサーバーへ明示トラック指定 (`'all'` ではなく実際のトラック) で
 *   開くため、この 1 本は副音声そのもの。選び直す先が無い)
 * - 0 本 (取得できず/タイムアウト) / 副音声 → false (選び直す対象が無い)
 * - 何本でも / 主音声 → false (新ストリームは常に主音声から始まるので何もしなくてよい)
 * @param audioRenditionCount 新しいストリームが実際に持つ音声レンディション数
 * @param isSecondaryTrackSelected 選択中の音声トラックが副音声か
 * @return boolean 選び直しが必要なら true
 */
export const needsAudioTrackReapplyAfterReconnect = (
    audioRenditionCount: number,
    isSecondaryTrackSelected: boolean,
): boolean => isSecondaryTrackSelected === true && audioRenditionCount >= 2;

/**
 * 音声レンディションの選び直しの適用結果から、実際に選択中として扱うべき音声トラックを返す。
 *
 * 適用に失敗した場合、新しいストリームは主音声のまま鳴り続けているため、UI と内部状態を
 * 実際の再生に合わせて 'main' へ戻す (要求した値のまま保持すると、次に同じ副音声を選んでも
 * 「選択に変化なし」の noop 判定で握りつぶされ、二度と切り替えられなくなる)。
 * @param requested 適用しようとした音声トラック
 * @param applied 適用できたか
 * @return string 選択中として扱う音声トラック
 */
export const resolveAppliedAudioTrack = (requested: string, applied: boolean): string =>
    applied === true ? requested : 'main';
