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
