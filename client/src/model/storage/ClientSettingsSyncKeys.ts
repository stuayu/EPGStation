/** サーバー同期を許可するキー。ここにない値は同期しない。 */
export const CLIENT_SETTINGS_SYNC_KEYS: Record<string, readonly string[]> = {
    settings: [
        'shouldUseOSColorTheme',
        'isForceDarkTheme',
        'themeColor',
        'isHalfWidthDisplayed',
        'isOnAirTabListView',
        'guideMode',
        'guideLength',
        'isForceDisableDarkThemeForGuide',
        'isShowOnlyFreePrograms',
        'isEnableDisplayForEachBroadcastWave',
        'isIncludeChannelIdWhenSearching',
        'isIncludeGenreWhenSearching',
        'reservesLength',
        'recordingLength',
        'recordedLength',
        'isShowTableMode',
        'isShowDropInfoInsteadOfDescription',
        'deleteRecordedDefaultValue',
        'searchLength',
        'isEnableAutoScrollWhenEditingRule',
        'isEnableCopyKeywordToDirectory',
        'isCheckAvoidDuplicate',
        'isEnableEncodingSettingWhenCreateRule',
        'isCheckDeleteOriginalAfterEncode',
        'rulesLength',
        'isForceEnableSubtitleStroke',
        'isEnableJikkyoComment',
        'isEnableJikkyoCommentPost',
        'jikkyoCommentMuteSettings',
        'nextUpPanelTab',
        'isEnableNextUpAutoPlayForLatestTab',
        'nextUpSeriesSortOrder',
        'isShowRecordedAsSeries',
        'channelGroupingType',
        'isShowFollowingIndicatorInGuide',
        'useDictionaryEpisodeTitle',
        'isEnableDataBroadcasting',
        'watchSidePanelTab',
        'pinnedChannelIds',
        'isEnableSnsPanel',
        'snsAutoAddChannelHashtag',
        'snsAutoAddProgramHashtag',
        'snsHashtagPosition',
        'snsResetHashtagOnProgramSwitch',
        'snsSavedHashtags',
        'snsFoldPanelAfterPost',
        'snsLastSelectedAccountIds',
        'snsRecentEmojiNames',
        'snsEnableComposePreview',
        // 同期しない: isEnablePWA は端末ごとのアプリ利用設定。
        // isPreferredPlayingLiveM2TSOnWeb / isPreferredPlayingOnWeb は端末・回線依存。
        // onAirM2TSViewURLScheme / shouldUseRecordedViewURLScheme / recordedViewURLScheme / shouldUseRecordedDownloadURLScheme / recordedDownloadURLScheme は端末固有 URL・再生環境。
        // jikkyoServerUrl は接続先、jikkyoLiveOffsetSec は端末ごとの時刻ずれ。
        // isOpenWatchSidePanel / isWatchVideoCompact / snsUseSplitPanelView / snsSplitPanelRatio は画面サイズ依存。
    ],
    GuideGenreSetting: Array.from({ length: 16 }, (_, index) => String(index)),
    // 同期しない: AddEncodeSeting.encodeMode / parentDirectory / isSaveSameDirectory / removeOriginal はサーバー設定・保存先・元ファイル削除に関わる。
    // OnAirSelectStreamSetting.useURLScheme / type / mode と RecordedSelectStreamSetting.type / mode は端末・回線・再生能力に依存。
    // SendVideoFileSelectHostSetting.hostName は端末・ネットワーク固有の送信先。
    // GuideSizeSetting.tablet / mobile の channelHeight / channelWidth / channelFontsize / timescaleHeight / timescaleWidth / timescaleFontsize / programFontSize は画面サイズ別レイアウト。
    // GuideProgramDetailSetting.encode / isDeleteOriginalAfterEncode はサーバー側エンコード設定・元ファイル削除に関わる。
};

export const CLIENT_SETTINGS_SYNC_ENABLED_KEY = 'ClientSettingsSyncEnabled';
