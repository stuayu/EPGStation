<template>
    <v-main>
        <TitleBar title="設定"></TitleBar>
        <transition name="page">
            <div v-if="isShow" ref="appContent" class="app-content">
                <v-container>
                    <!-- 保存ボタンはページ最下部にあり、設定項目が多いと画面外に出るため、
                         未保存であることは最上部に出したうえでスクロールに追従させる -->
                    <div v-if="isDirty === true" class="unsaved-bar mb-4">
                        <v-alert type="warning" variant="flat" density="compact" class="d-flex align-center">
                            <div class="d-flex align-center flex-wrap ga-2">
                                <span class="text-body-2">未保存の変更があります (保存せずに移動すると破棄されます)</span>
                                <v-spacer></v-spacer>
                                <v-btn size="small" variant="outlined" v-on:click="save">保存</v-btn>
                            </div>
                        </v-alert>
                    </div>
                    <v-btn v-if="isShowSystemSettings === true" block color="primary" class="mb-4" to="/settings/system">サーバー設定を開く</v-btn>
                    <!-- サーバー設定の導線が機能フラグ由来で消えたのか、config 取得失敗で消えたのかを区別できるようにする -->
                    <v-alert v-else-if="isServerConfigMissing === true" type="warning" variant="tonal" class="mb-4">
                        <div class="d-flex align-center flex-wrap ga-2">
                            <span class="text-body-2">サーバーの設定情報を取得できていないため、サーバー設定への導線を表示できません。</span>
                            <v-spacer></v-spacer>
                            <v-btn size="small" variant="outlined" :loading="isRetryingServerConfig" @click="retryFetchServerConfig">再取得</v-btn>
                        </div>
                    </v-alert>
                    <!-- 認証が有効なときだけログイン状態を出す -->
                    <v-card v-if="isAuthEnabled === true" class="mx-auto mb-4" max-width="800">
                        <v-card-text class="d-flex align-center ga-2 flex-wrap">
                            <template v-if="loginUserName !== null">
                                <span class="text-body-2">{{ loginUserName }} としてログイン中</span>
                                <v-chip v-if="isAdmin === true" size="x-small" color="deep-purple" variant="flat">システム管理者</v-chip>
                                <v-spacer></v-spacer>
                                <v-btn size="small" variant="outlined" @click="logout">ログアウト</v-btn>
                            </template>
                            <template v-else>
                                <span class="text-body-2">ログインしていません (閲覧・予約などは利用できます)</span>
                                <v-spacer></v-spacer>
                                <v-btn size="small" color="primary" variant="flat" @click="login">ログイン</v-btn>
                            </template>
                        </v-card-text>
                    </v-card>
                    <v-card class="mx-auto" max-width="800">
                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">全般</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">PWA</v-list-item-title>
                                        <v-list-item-subtitle>PWAを有効化する(※再読込後有効になります)</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnablePWA"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">OSカラーテーマ</v-list-item-title>
                                        <v-list-item-subtitle>OSのカラーテーマに連動させる</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="shouldUseOSColorTheme"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">ダークテーマ</v-list-item-title>
                                        <v-list-item-subtitle>ダークテーマを有効化する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="isForceDarkTheme" :disabled="shouldUseOSColorTheme"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">テーマカラー</v-list-item-title>
                                        <v-list-item-subtitle>ヘッダー・メニュー・スイッチ・進捗バーの色</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select v-model="themeColor" :items="themeColorItems" class="theme-color"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">半角表示</v-list-item-title>
                                        <v-list-item-subtitle>強制的に半角表示にする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isHalfWidthDisplayed"></v-switch>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">放映中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>放送波毎にタブで分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isOnAirTabListView"></v-switch>
                                </div>
                                <div v-if="isSupportedMpegts" class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">web での再生を優先する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isPreferredPlayingLiveM2TSOnWeb"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="text-subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.onAirM2TSViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">番組表</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">描画設定</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideModeItems" v-model="storageModel.tmp.guideMode" class="guide-mode"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">表示時間</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideLengthItems" v-model="storageModel.tmp.guideLength" class="guide-time"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">ダークテーマの配色を無効化する</v-list-item-title>
                                        <v-list-item-subtitle>ダークテーマ使用時でも通常時と同じ配色設定になります</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isForceDisableDarkThemeForGuide" :disabled="$vuetify.theme.global.current.dark === false"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">無料放送だけ表示する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowOnlyFreePrograms"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>ナビゲーションの表示を放送波別に分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableDisplayForEachBroadcastWave"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">検索時に放送局情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeChannelIdWhenSearching"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">検索時にジャンル情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeGenreWhenSearching"></v-switch>
                                </div>
                                <div v-if="isShowFollowingIndicatorSetting === true" class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">追いかけ中インジケータ</v-list-item-title>
                                        <v-list-item-subtitle>録画済みシリーズにつながる番組に印を表示する (簡易判定)</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowFollowingIndicatorInGuide"></v-switch>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">予約</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="reservesLengthItems" v-model="storageModel.tmp.reservesLength" class="guide-time"></v-select>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>
                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">録画中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordingLengthItems" v-model="storageModel.tmp.recordingLength" class="guide-time"></v-select>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">録画</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordedLengthItems" v-model="storageModel.tmp.recordedLength" class="guide-time"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">テーブル表示</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowTableMode"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">ドロップ情報を表示する</v-list-item-title>
                                        <v-list-item-subtitle>概要の代わりにドロップとファイルサイズ情報を表示する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowDropInfoInsteadOfDescription"></v-switch>
                                </div>
                                <div v-if="isShowSeriesLibrarySetting === true" class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">既定でシリーズ表示にする</v-list-item-title>
                                        <v-list-item-subtitle>録画済み一覧を開いたときにシリーズ単位表示を初期表示にする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowRecordedAsSeries"></v-switch>
                                </div>

                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">削除時のチェックを入れるか</v-list-item-title>
                                        <v-list-item-subtitle>有効にするとファイル削除のチェックが入れられた状態で録画削除ダイアログが開かれます</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.deleteRecordedDefaultValue"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">web での再生を優先する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isPreferredPlayingOnWeb"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="text-subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedViewURLScheme"></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="text-subtitle-1">ダウンロード URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedDownloadURLScheme"></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedDownloadURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">検索</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">最大表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="searchLengthItems" v-model="storageModel.tmp.searchLength" class="guide-time"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">自動スクロール</v-list-item-title>
                                        <v-list-item-subtitle>ルール編集時に検索結果へ自動スクロールする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableAutoScrollWhenEditingRule"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">自動サブディレクトリ設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にキーワードをサブディレクトリにコピーする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableCopyKeywordToDirectory"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">録画済み番組を排除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に録画済み番組を排除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckAvoidDuplicate"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">エンコードの自動設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にエンコード設定を自動で行う</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableEncodingSettingWhenCreateRule"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">元ファイルの自動削除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に元ファイルの自動削除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckDeleteOriginalAfterEncode"></v-switch>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">ルール</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="rulesLengthItems" v-model="storageModel.tmp.rulesLength" class="guide-time"></v-select>
                                </div>
                            </div>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <div class="v-list-item-content">
                                <div class="title">ビデオプレーヤ</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">字幕の縁取りを強制する</v-list-item-title>
                                        <v-list-item-subtitle>aribb24.js 使用時に有効になります</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isForceEnableSubtitleStroke"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="text-subtitle-1">ニコニコ実況コメントを表示する</v-list-item-title>
                                        <v-list-item-subtitle>ライブ視聴時に NX-Jikkyo のコメントを弾幕表示します</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableJikkyoComment"></v-switch>
                                </div>
                                <div class="my-2">
                                    <v-list-item-title class="text-subtitle-1">実況コメントサーバー (NX-Jikkyo)</v-list-item-title>
                                    <v-text-field v-model="storageModel.tmp.jikkyoServerUrl" label="URL"></v-text-field>
                                </div>
                                <div class="my-2">
                                    <v-list-item-title class="text-subtitle-1">実況コメントの表示タイミング微調整</v-list-item-title>
                                    <v-list-item-subtitle>
                                        ライブ視聴時のコメントは、放送波の時刻 (TDT/TOT) と再生バッファから配信遅延を自動で補正します。それでもずれる場合に秒数で微調整します (正の値でコメントを遅らせ、負の値で早めます)
                                    </v-list-item-subtitle>
                                    <v-text-field
                                        v-model.number="storageModel.tmp.jikkyoLiveOffsetSec"
                                        type="number"
                                        step="0.5"
                                        label="オフセット (秒)"
                                        style="max-width: 200px"
                                    ></v-text-field>
                                </div>
                            </div>
                        </v-list-item>

                        <template v-if="isShowNextUpPanelSetting">
                            <v-divider></v-divider>

                            <v-list-item three-line>
                                <div class="v-list-item-content">
                                    <div class="title">Next Up パネル</div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="text-subtitle-1">新着タブの連続再生</v-list-item-title>
                                            <v-list-item-subtitle
                                                >有効にすると新着タブ選択時も再生終了前にカウントダウンして自動で次を再生します (シリーズタブは常時有効)</v-list-item-subtitle
                                            >
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.isEnableNextUpAutoPlayForLatestTab"></v-switch>
                                    </div>
                                </div>
                            </v-list-item>
                        </template>

                        <v-card-actions class="flex-wrap">
                            <!-- 未保存であることは最上部の追従バーが担うため、ここは保存済みの表示だけ -->
                            <div v-if="isDirty === false" class="text-medium-emphasis text-body-2 ml-2">保存済みです</div>
                            <v-spacer></v-spacer>
                            <v-btn variant="text" v-on:click="reset">リセット</v-btn>
                            <v-btn variant="text" color="primary" v-on:click="save">保存</v-btn>
                        </v-card-actions>
                    </v-card>
                    <div style="visibility: hidden">dummy</div>
                </v-container>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IAuthApiModel from '@/model/api/auth/IAuthApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState from '@/model/state/navigation/INavigationState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, GuideViewMode } from '@/model/storage/setting/ISettingStorageModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import IColorThemeState from '@/model/state/IColorThemeState';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import ThemeColorUtil from '@/util/ThemeColorUtil';

interface GuideModeItem {
    title: string;
    value: GuideViewMode;
}

interface SelectItem {
    title: string;
    value: number;
}

@Component({
    components: {
        TitleBar,
    },
})
class Settings extends Vue {
    public isShow: boolean = false;
    public storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private colorThemeState: IColorThemeState = container.get<IColorThemeState>('IColorThemeState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * Next Up パネル関連の設定項目を表示するか (featureFlags.nextUpPanel 連動)
     */
    get isShowNextUpPanelSetting(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'nextUpPanel');
    }

    /**
     * シリーズライブラリ関連の設定項目を表示するか (featureFlags.seriesLibrary 連動)
     */
    get isShowSeriesLibrarySetting(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    /**
     * 番組表の追いかけ中インジケータ設定を表示するか (featureFlags.seriesLibrary かつ programSeriesMapping 連動)
     */
    get isShowFollowingIndicatorSetting(): boolean {
        const config = this.serverConfigModel.getConfig();
        return isFeatureEnabled(config, 'seriesLibrary') === true && isFeatureEnabled(config, 'programSeriesMapping') === true;
    }

    /**
     * サーバー設定 (システム設定) 画面への導線を表示するか。
     * featureFlags.systemSettings に加え、認証有効時はシステム管理者のみに見せる
     */
    get isShowSystemSettings(): boolean {
        // serverConfigModel はリアクティブではないため、再取得したことを画面へ伝える目的で
        // serverConfigRevision を参照している (値そのものは使わない)
        void this.serverConfigRevision;
        if (isFeatureEnabled(this.serverConfigModel.getConfig(), 'systemSettings') === false) return false;
        return this.isAdmin;
    }

    /**
     * サーバーの config を取得できていないか
     * isFeatureEnabled() は config 未取得 (null) でも false を返すため、
     * これが true のときは「機能が無効」ではなく「判断できない」状態を意味する
     */
    get isServerConfigMissing(): boolean {
        void this.serverConfigRevision;

        return this.serverConfigModel.getConfig() === null;
    }

    // serverConfigModel は DI のプレーンクラスでリアクティブではないため、
    // 再取得のたびにこの値を進めて getter を再評価させる
    serverConfigRevision = 0;
    isRetryingServerConfig = false;

    /**
     * サーバーの config を取得し直す
     * 起動時の取得は main.ts の 1 回きりで、失敗すると機能フラグ由来の導線が
     * 黙って消えたままになるため、設定画面から再試行できるようにしている
     */
    public async retryFetchServerConfig(): Promise<void> {
        if (this.isRetryingServerConfig === true) return;

        this.isRetryingServerConfig = true;
        try {
            await this.serverConfigModel.fetchConfig();
            this.serverConfigRevision++;
            if (this.serverConfigModel.getConfig() !== null) {
                this.snackbarState.open({
                    text: 'サーバーの設定情報を取得しました',
                    color: 'success',
                });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'サーバーの設定情報を取得できませんでした',
            });
        }
        this.isRetryingServerConfig = false;
    }

    // 認証が無効な場合は全員が管理者相当として扱う (従来どおりの動作)
    isAdmin = true;
    isAuthEnabled = false;
    loginUserName: string | null = null;

    async loadAuthRole(): Promise<void> {
        try {
            const status = await container.get<IAuthApiModel>('IAuthApiModel').getStatus();
            this.isAuthEnabled = status.enabled;
            this.loginUserName = status.user?.name ?? null;
            this.isAdmin = status.enabled === false || status.user?.role === 'admin';
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * ログイン画面へ移動する (匿名利用が許可されている場合はここからログインする)
     */
    public login(): void {
        window.location.replace(`${window.location.pathname}?login=1`);
    }

    public async logout(): Promise<void> {
        try {
            await container.get<IAuthApiModel>('IAuthApiModel').logout();
        } catch (err) {
            console.error(err);
        }
        window.location.replace(window.location.pathname);
    }

    public readonly guideModeItems: GuideModeItem[] = [
        {
            title: '逐次',
            value: 'sequential',
        },
        {
            title: '最小',
            value: 'minimum',
        },
        {
            title: 'すべて',
            value: 'all',
        },
    ];

    public themeColorItems: ThemeColorUtil.ThemeColorDefinition[] = ThemeColorUtil.COLORS;
    public guideLengthItems: SelectItem[] = [];
    public reservesLengthItems: SelectItem[] = [];
    public recordingLengthItems: SelectItem[] = [];
    public recordedLengthItems: SelectItem[] = [];
    public searchLengthItems: SelectItem[] = [];
    public rulesLengthItems: SelectItem[] = [];

    get shouldUseOSColorTheme(): boolean {
        return this.storageModel.tmp.shouldUseOSColorTheme;
    }

    set shouldUseOSColorTheme(value: boolean) {
        this.storageModel.tmp.shouldUseOSColorTheme = value;
        if (value) {
            this.isForceDarkTheme = this.colorThemeState.isTmpDarkTheme();
        }
    }

    get isForceDarkTheme(): boolean {
        return this.storageModel.tmp.isForceDarkTheme;
    }

    set isForceDarkTheme(value: boolean) {
        this.storageModel.tmp.isForceDarkTheme = value;
        this.$vuetify.theme.change(value ? 'dark' : 'light');
    }

    get themeColor(): ThemeColorUtil.ThemeColorType {
        return this.colorThemeState.getTmpThemeColor();
    }

    set themeColor(value: ThemeColorUtil.ThemeColorType) {
        this.storageModel.tmp.themeColor = value;
        // 保存前にその場で見た目を確認できるようにする (保存せずページを離れると unmounted で元へ戻る)
        ThemeColorUtil.apply(this.$vuetify.theme, value);
    }

    get isSupportedMpegts(): boolean {
        return StreamSupportUtil.isM2TSLLSupported();
    }

    public created(): void {
        this.isForceDarkTheme = this.colorThemeState.isTmpDarkTheme();

        for (let i = 1; i <= 24; i++) {
            this.guideLengthItems.push({
                title: i.toString(10),
                value: i,
            });
        }

        for (let i = 1; i <= 100; i++) {
            const item: SelectItem = {
                title: i.toString(10),
                value: i,
            };
            this.reservesLengthItems.push(item);
            this.recordingLengthItems.push(item);
            this.recordedLengthItems.push(item);
            this.rulesLengthItems.push(item);
        }

        for (let i = 50; i <= 600; i += 50) {
            const item: SelectItem = {
                title: i.toString(10),
                value: i,
            };
            this.searchLengthItems.push(item);
        }

        // 上の isForceDarkTheme の代入で tmp が動くため、その後に控える
        // (OS テーマ連動時は保存値と実際のテーマが食い違い、常に未保存扱いになってしまう)
        this.updateSavedSnapshot();
    }

    public mounted(): void {
        void this.loadAuthRole();

        // 起動時の取得に失敗していた場合はここで 1 度だけ取り直す
        if (this.serverConfigModel.getConfig() === null) {
            void this.retryFetchServerConfig();
        }
    }

    public beforeUnmount(): void {
        this.isShow = false;
    }

    public unmounted(): void {
        // ページから移動するときに tmp をリセット
        this.storageModel.resetTmpValue();
        ThemeColorUtil.apply(this.$vuetify.theme, this.colorThemeState.getThemeColor());
        this.$vuetify.theme.change(this.colorThemeState.isDarkTheme() ? 'dark' : 'light');
    }

    /**
     * setting の tmp をデフォルト値へリセットする
     */
    public reset(): void {
        this.storageModel.tmp = this.storageModel.getDefaultValue();
        ThemeColorUtil.apply(this.$vuetify.theme, this.colorThemeState.getTmpThemeColor());
        this.$vuetify.theme.change(this.colorThemeState.isDarkTheme() ? 'dark' : 'light');
    }

    /**
     * tmp の値を保存する
     */
    public save(): void {
        this.storageModel.save();
        this.navigationState.updateItems(this.$route);
        this.updateSavedSnapshot();

        this.snackbarState.open({
            text: '保存されました',
            color: 'success',
        });
    }

    /**
     * 未保存の変更があるか
     * 保存済みの内容をそのまま持っておき、編集中の tmp と比較する。
     * localStorage を都度読み直さないのは、保存後に getter が
     * 再評価されず「未保存」の表示が残ってしまうため
     */
    get isDirty(): boolean {
        return JSON.stringify(this.storageModel.tmp) !== this.savedSnapshot;
    }

    // 保存済みの設定内容 (JSON 文字列)
    savedSnapshot = '';

    /**
     * 保存済みの内容として現在の tmp を控える
     */
    private updateSavedSnapshot(): void {
        this.savedSnapshot = JSON.stringify(this.storageModel.tmp);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(() => {
            this.isShow = true;

            this.$nextTick(async () => {
                // スクロール位置復元を許可
                await this.scrollState.emitDoneGetData();
            });
        });
    }
}

export default toNative(Settings);
</script>

<style lang="sass" scoped>
// スクロールしても画面上端に留まる。
// top を 0 にすると固定表示のヘッダー (v-app-bar) の裏へ潜って見えなくなるため、
// Vuetify がレイアウトから算出しているヘッダーの高さ (--v-layout-top) だけ下げる
.unsaved-bar
    position: sticky
    top: var(--v-layout-top, 64px)
    z-index: 5
.theme-color
    max-width: 170px
.guide-mode
    max-width: 120px
.guide-time
    max-width: 90px

// 設定行 (説明 + v-spacer + スイッチ / セレクト)。
// 既定では説明側の div が縮まず、入力側の .v-input (flex: 1 1 auto) だけが縮むため、
// 狭い端末では説明が 1 行のまま伸びてスイッチが画面外へ押し出され、
// セレクトは「ブ...」のように選択値が読めない幅まで潰れる
.my-2.d-flex.flex-row.align-center
    > div:first-child
        flex: 1 1 auto
        min-width: 0

    > .v-input
        flex: 0 0 auto

// v-list-item-title は 1 行固定 (nowrap + ellipsis) なので、狭い端末では項目名の
// 後半が読めなくなる (「実況コメントサーバー (NX-Jikky...」)。設定項目名は折り返す
.my-2.d-flex .v-list-item-title
    white-space: normal
</style>

<style lang="sass">
// toggle switch の橋が途切れるため
.v-input--switch
    margin-right: 4px
    margin-top: 0 !important
    padding-top: 0 !important
    .v-input__slot
        margin-bottom: 0 !important
    .v-messages
        display: none
</style>
