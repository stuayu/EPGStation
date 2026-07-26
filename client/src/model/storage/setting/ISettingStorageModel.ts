import IStorageBaseModel from '../IStorageBaseModel';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';

export interface ISettingValue {
    isEnablePWA: boolean;
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    isHalfWidthDisplayed: boolean;
    isOnAirTabListView: boolean;
    isPreferredPlayingLiveM2TSOnWeb: boolean;
    onAirM2TSViewURLScheme: string | null;
    guideMode: GuideViewMode;
    guideLength: number;
    isForceDisableDarkThemeForGuide: boolean;
    isShowOnlyFreePrograms: boolean;
    isEnableDisplayForEachBroadcastWave: boolean;
    isIncludeChannelIdWhenSearching: boolean;
    isIncludeGenreWhenSearching: boolean;
    reservesLength: number;
    recordingLength: number;
    recordedLength: number;
    isShowTableMode: boolean;
    isPreferredPlayingOnWeb: boolean;
    isShowDropInfoInsteadOfDescription: boolean;
    deleteRecordedDefaultValue: boolean;
    shouldUseRecordedViewURLScheme: boolean;
    recordedViewURLScheme: string | null;
    shouldUseRecordedDownloadURLScheme: boolean;
    recordedDownloadURLScheme: string | null;
    searchLength: number;
    isEnableAutoScrollWhenEditingRule: boolean;
    isEnableCopyKeywordToDirectory: boolean;
    isCheckAvoidDuplicate: boolean;
    isEnableEncodingSettingWhenCreateRule: boolean;
    isCheckDeleteOriginalAfterEncode: boolean;
    rulesLength: number;
    isForceEnableSubtitleStroke: boolean; // 字幕縁取りを強制するか
    isEnableJikkyoComment: boolean; // ニコニコ実況コメントを弾幕表示するか
    jikkyoServerUrl: string; // NX-Jikkyo サーバーの URL
    isNextUpPanelOpen: boolean; // Next Up パネルの開閉状態
    nextUpPanelTab: 'latest' | 'series'; // Next Up パネルの選択タブ
    isEnableNextUpAutoPlayForLatestTab: boolean; // 新着タブ選択時に連続再生を有効にするか (既定 OFF。シリーズタブは常時有効)
}

export type ISettingStorageModel = IStorageBaseModel<ISettingValue>;
