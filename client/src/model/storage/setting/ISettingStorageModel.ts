import IStorageBaseModel from '../IStorageBaseModel';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';

// 地上波系の放送局のまとめ方 (地域別 / 系列別)
export type ChannelGroupingType = 'region' | 'affiliation';

// 視聴画面の右パネルのタブ
export type WatchSidePanelTab = 'program' | 'channel' | 'nextup' | 'comment';

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
    // ライブ視聴時のコメント表示を追加で遅らせる秒数 (負の値で早める)。
    // 配信遅延はサーバの放送時刻 (TDT/TOT) と再生バッファから自動で補正するが、
    // 環境ごとのずれを手で詰めるための微調整値
    jikkyoLiveOffsetSec: number;
    nextUpPanelTab: 'latest' | 'series'; // Next Up パネルの選択タブ
    isEnableNextUpAutoPlayForLatestTab: boolean; // 新着タブ選択時に連続再生を有効にするか (既定 OFF。シリーズタブは常時有効)
    isShowRecordedAsSeries: boolean; // 録画済み一覧をシリーズ単位表示にするか (既定 OFF。互換性維持のため従来のフラット表示が既定)
    channelGroupingType: ChannelGroupingType; // 番組表・放映中で地上波系をまとめる軸 (既定 地域別)
    isShowFollowingIndicatorInGuide: boolean; // 番組表に「追いかけ中」インジケータを表示するか (featureFlags.seriesLibrary かつ programSeriesMapping が有効な場合のみ意味を持つ)
    // シリーズ詳細のエピソード名を作品辞書 (しょぼいカレンダー) 由来の「第N話 サブタイトル」で表示するか。
    // false の場合は録画タイトルをそのまま表示する (既定 true)
    useDictionaryEpisodeTitle: boolean;
    // 視聴画面でデータ放送 (BML) レイヤーを表示するか (featureFlags.dataBroadcasting が有効な場合のみ意味を持つ、既定 OFF)
    isEnableDataBroadcasting: boolean;
    // 視聴画面の右パネルを開いているか (既定 開いている)
    isOpenWatchSidePanel: boolean;
    // 視聴画面の右パネルで選択しているタブ
    watchSidePanelTab: WatchSidePanelTab;
    // 視聴画面のチャンネル一覧でピン留めしている放送局 (ChannelId の配列)
    pinnedChannelIds: number[];
}

export type ISettingStorageModel = IStorageBaseModel<ISettingValue>;
