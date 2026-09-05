import IStorageBaseModel from '../IStorageBaseModel';
import ThemeColorUtil from '@/util/ThemeColorUtil';
import ProgramHashtagUtil from '@/util/ProgramHashtagUtil';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';

// 地上波系の放送局のまとめ方 (地域別 / 系列別)
export type ChannelGroupingType = 'region' | 'affiliation';

// 視聴画面の右パネルのタブ
export type WatchSidePanelTab = 'program' | 'channel' | 'nextup' | 'comment' | 'sns';

export interface ISettingValue {
    isEnablePWA: boolean;
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    // システム全体のテーマカラー (ヘッダー・ナビゲーション・トグル・プログレスバー)
    themeColor: ThemeColorUtil.ThemeColorType;
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
    // Next Up パネルとシリーズ詳細の録画一覧の並び順 (見た目だけの設定。次に再生する話数の判定には使わない)
    nextUpSeriesSortOrder: 'episodeAsc' | 'episodeDesc';
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
    // 狭い端末 (映像とパネルが縦に並ぶ幅) で映像を小さくしてパネルを広げるか (既定 OFF)
    isWatchVideoCompact: boolean;
    // 視聴画面のチャンネル一覧でピン留めしている放送局 (ChannelId の配列)
    pinnedChannelIds: number[];
    // 視聴画面の SNS 投稿パネルを有効にするか (既定 有効。連携アカウントが 0 件の場合はタブ自体を出さない)
    isEnableSnsPanel: boolean;
    // 局タグ (放送局名から解決したハッシュタグ) を自動で合成対象に含めるか
    snsAutoAddChannelHashtag: boolean;
    // 番組概要・詳細から抽出したハッシュタグを自動で合成対象に含めるか
    snsAutoAddProgramHashtag: boolean;
    // ハッシュタグを本文へ差し込む位置
    snsHashtagPosition: ProgramHashtagUtil.HashtagPosition;
    // 番組が切り替わったときにハッシュタグ入力欄をリセットしてから自動合成し直すか
    snsResetHashtagOnProgramSwitch: boolean;
    // ハッシュタグのプリセット (並び順を保持)
    snsSavedHashtags: string[];
    // 投稿成功後に SNS 投稿パネルを畳むか
    snsFoldPanelAfterPost: boolean;
    // 直近に選択していた投稿先アカウント ID (SnsAccountId の配列)
    snsLastSelectedAccountIds: number[];
    // 絵文字ピッカーで最近使った絵文字名 (新しい順、上限 30 件)
    snsRecentEmojiNames: string[];
    // SNS 投稿パネルを「投稿」「タイムライン」のタブ排他切替ではなく、縦分割で同時表示するか (既定 true = 分割)。
    // 狭い端末 ($vuetify.display.smAndDown) では常にタブ切替になり、この設定は無視される
    snsUseSplitPanelView: boolean;
    // 縦分割表示時の投稿フォーム側の高さ比率 (0.2 〜 0.8)
    snsSplitPanelRatio: number;
    // 本文入力欄の下にカスタム絵文字・MFM 記法のライブプレビューを出すか (既定 true)
    snsEnableComposePreview: boolean;
}

export type ISettingStorageModel = IStorageBaseModel<ISettingValue>;
