<template>
    <v-main>
        <TitleBar :title="detail?.title || 'シリーズ詳細'">
            <template v-slot:menu>
                <!-- 狭い端末ではアイコンを並べるとシリーズ名が読めなくなるため、
                     通常時の操作はケバブメニューへまとめる (モード解除は常にアイコンで出す) -->
                <v-btn
                    v-if="isMobile === false && isBulkMode === false && isSplitMode === false"
                    icon
                    variant="text"
                    size="small"
                    @click="startBulkEdit"
                    title="話数・放送種別の一括編集"
                >
                    <v-icon>mdi-playlist-edit</v-icon>
                </v-btn>
                <v-btn v-if="isBulkMode === true" icon variant="text" size="small" @click="cancelBulkEdit" title="一括編集をやめる">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
                <v-btn
                    v-if="isMobile === false && isSplitMode === false && isBulkMode === false"
                    icon
                    variant="text"
                    size="small"
                    @click="isSplitMode = true"
                    title="分割"
                >
                    <v-icon>mdi-call-split</v-icon>
                </v-btn>
                <v-btn v-if="isSplitMode === true" icon variant="text" size="small" @click="cancelSplit" title="分割をやめる">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
                <SeriesTitleDisplayMenu
                    :show-edit-actions="isMobile === true && isBulkMode === false && isSplitMode === false"
                    v-on:changed="onChangedTitleDisplay"
                    v-on:bulkedit="startBulkEdit"
                    v-on:split="isSplitMode = true"
                ></SeriesTitleDisplayMenu>
            </template>
        </TitleBar>
        <v-container v-if="detail">
            <!-- シリーズの概要ヘッダ: アイキャッチ画像・基本情報・視聴進捗・操作をまとめて上部に置く -->
            <v-card class="series-hero mb-4" variant="outlined">
                <div class="d-flex flex-column flex-sm-row">
                    <div class="series-hero__image">
                        <!-- アイキャッチ画像 (Annict 由来、無ければ録画サムネイル)。どちらも無い作品は代替表示 -->
                        <v-img
                            v-if="detail.hasImage"
                            :src="`./api/series/${detail.id}/image`"
                            :alt="detail.title"
                            :aspect-ratio="16 / 9"
                            cover
                            class="bg-grey-lighten-3 h-100"
                        >
                            <template v-slot:placeholder>
                                <div class="d-flex align-center justify-center fill-height">
                                    <v-progress-circular indeterminate size="24" color="grey"></v-progress-circular>
                                </div>
                            </template>
                            <template v-slot:error>
                                <div class="d-flex align-center justify-center fill-height">
                                    <v-icon size="40" color="grey">mdi-image-off-outline</v-icon>
                                </div>
                            </template>
                        </v-img>
                        <div v-else class="d-flex align-center justify-center bg-grey-lighten-3 h-100" :style="{ aspectRatio: '16 / 9' }">
                            <v-icon size="40" color="grey">mdi-television-classic</v-icon>
                        </div>
                    </div>

                    <div class="series-hero__body d-flex flex-column pa-4">
                        <div class="text-h6 text-sm-h5">{{ detail.title }}</div>
                        <div v-if="detail.titleKana" class="text-caption text-medium-emphasis">{{ detail.titleKana }}</div>

                        <!-- 状態チップ -->
                        <div class="d-flex align-center ga-1 flex-wrap mt-2">
                            <v-chip v-if="detail.isOnAir" size="small" color="primary" variant="flat">放送中</v-chip>
                            <v-chip size="small" :color="originColor" variant="flat" :title="originTitle">{{ originText }}</v-chip>
                            <v-chip size="small" variant="tonal">{{ detail.mediaType }}</v-chip>
                            <v-chip v-if="detail.unwatchedCount > 0" size="small" color="info" variant="flat">未視聴 {{ detail.unwatchedCount }}</v-chip>
                            <v-chip v-if="detail.missingEpisodeCount > 0" size="small" color="warning" variant="flat" :title="missingEpisodeText">
                                欠番 {{ detail.missingEpisodeCount }}
                            </v-chip>
                            <v-chip v-if="detail.duplicateEpisodeCount > 0" size="small" color="grey" variant="flat" :title="duplicateEpisodeText">
                                重複 {{ detail.duplicateEpisodeCount }}
                            </v-chip>
                            <v-chip v-if="detail.titleSource === 'manual'" size="small" color="primary" variant="tonal">シリーズ名は手動設定</v-chip>
                        </div>

                        <!-- 基本情報 -->
                        <div class="series-hero__meta text-body-2 text-medium-emphasis mt-3">
                            <span>
                                クール: {{ seasonText }}
                                <span v-if="detail.seasonSource === 'estimated'" class="text-caption" title="録画日時からの推測値です">(推定)</span>
                            </span>
                            <span>録画: {{ detail.recordedCount }} 件{{ totalEpisodesText }}</span>
                            <span>容量: {{ fileSizeText }}</span>
                            <span>放送局: {{ detail.channels.length }} 局</span>
                            <span v-if="detail.firstAiredAt">初回: {{ formatDay(detail.firstAiredAt) }}</span>
                            <span v-if="detail.lastAiredAt">最新: {{ formatDay(detail.lastAiredAt) }}</span>
                        </div>

                        <!-- 視聴進捗 -->
                        <div class="mt-3">
                            <v-progress-linear :model-value="watchedPercent" height="6" color="info" bg-color="grey-lighten-2" rounded></v-progress-linear>
                            <div class="text-caption text-medium-emphasis mt-1">
                                {{ detail.recordedCount - detail.unwatchedCount }}/{{ detail.recordedCount }} 視聴 ({{ watchedPercent }}%)
                            </div>
                        </div>

                        <v-spacer></v-spacer>

                        <!-- 外部辞書のタグ (クリックで元サイトの作品ページを開く) と操作 -->
                        <div class="d-flex align-center flex-wrap ga-2 mt-3">
                            <SeriesExternalLinks :externalIds="detail.externalIds"></SeriesExternalLinks>
                            <v-spacer></v-spacer>
                            <!-- 表示名・クール・読み仮名・総話数を作品辞書から取り直す (このシリーズだけ) -->
                            <v-btn variant="outlined" size="small" prepend-icon="mdi-sync" :loading="metadataSyncing" @click="refreshMetadata">
                                辞書から再取得
                            </v-btn>
                            <!-- このシリーズの録画をまとめてシリーズ判定にかけ直す (話数・サブタイトル・放送種別) -->
                            <v-btn
                                variant="outlined"
                                size="small"
                                prepend-icon="mdi-refresh-auto"
                                :loading="reanalyzing"
                                @click="isOpenReanalyzeDialog = true"
                                title="このシリーズの各録画の話数・放送種別を外部データから引き直す"
                            >
                                録画を再問い合わせ
                            </v-btn>
                            <v-btn variant="outlined" size="small" :loading="annictSyncing" @click="syncAnnict">Annict同期</v-btn>
                        </div>
                    </div>
                </div>
                <div v-if="detail.imageSource === 'thumbnail' || detail.imageCopyright" class="d-flex align-center ga-1 px-4 pb-2 text-caption text-medium-emphasis">
                    <v-icon v-if="detail.imageSource === 'thumbnail'" size="x-small" title="録画サムネイルを表示しています">mdi-video-outline</v-icon>
                    <span v-if="detail.imageSource === 'thumbnail'">録画サムネイル</span>
                    <span v-if="detail.imageCopyright" class="text-truncate" :title="detail.imageCopyright">{{ detail.imageCopyright }}</span>
                </div>
            </v-card>

            <v-alert v-if="annictMessage" type="success" density="compact" variant="tonal" class="mb-3">{{ annictMessage }}</v-alert>
            <v-alert v-if="detail.continuity.missingEpisodes.length" type="warning" density="compact" variant="tonal" class="mb-3">
                欠番: {{ missingEpisodeText }}
            </v-alert>
            <v-alert v-if="detail.continuity.duplicateEpisodes.length" type="info" density="compact" variant="tonal" class="mb-3">
                複数録画・再放送: {{ duplicateEpisodeText }}
            </v-alert>

            <v-card v-if="futureProposals.length > 0" class="mb-3" variant="outlined">
                <v-card-title class="text-subtitle-1">今後の放送予定・欠番補完</v-card-title>
                <v-list>
                    <v-list-item v-for="p in futureProposals" :key="`${p.seasonNumber}-${p.episodeNumber}`">
                        <v-list-item-title>S{{ p.seasonNumber }} 第{{ p.episodeNumber }}話</v-list-item-title>
                        <v-list-item-subtitle v-for="c in p.candidates" :key="c.programId">
                            {{ c.name }} ({{ formatDate(c.startAt) }})
                            <v-btn size="x-small" variant="text" color="primary" :loading="reservingKey === `${p.seasonNumber}-${p.episodeNumber}-${c.programId}`" @click="reserveProposal(p, c)"
                                >予約</v-btn
                            >
                        </v-list-item-subtitle>
                    </v-list-item>
                </v-list>
            </v-card>

            <!-- 作品コメント (しょぼいカレンダー由来 / 手動編集) -->
            <v-card v-if="detail.comment || isBulkMode === false" class="mb-3" variant="outlined">
                <v-card-title class="d-flex align-center text-subtitle-1">
                    <span>作品コメント</span>
                    <v-chip v-if="detail.commentSource === 'manual'" class="ml-2" size="x-small" color="primary">手動</v-chip>
                    <v-chip v-else-if="detail.commentSource === 'dictionary'" class="ml-2" size="x-small">しょぼいカレンダー</v-chip>
                    <v-spacer></v-spacer>
                    <v-btn icon variant="text" size="small" title="コメントを編集" @click="openCommentDialog">
                        <v-icon>mdi-pencil</v-icon>
                    </v-btn>
                    <v-btn v-if="detail.comment" icon variant="text" size="small" title="コメントを削除" @click="isOpenDeleteCommentDialog = true">
                        <v-icon>mdi-delete</v-icon>
                    </v-btn>
                </v-card-title>
                <v-card-text v-if="detail.comment">
                    <SyobocalComment :comment="detail.comment" :collapsible="true"></SyobocalComment>
                </v-card-text>
                <v-card-text v-else class="text-grey">コメントはありません</v-card-text>
            </v-card>

            <div class="d-flex align-center ga-2">
                <v-select
                    v-model="channelId"
                    :items="channelItems"
                    item-title="title"
                    item-value="value"
                    label="放送局で絞り込み"
                    class="flex-grow-1"
                    @update:model-value="load"
                ></v-select>
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    :title="recordedSortOrder === 'episodeAsc' ? '1話順' : '最新話順'"
                    :aria-label="recordedSortOrder === 'episodeAsc' ? '並び順: 1話順' : '並び順: 最新話順'"
                    @click="toggleRecordedSortOrder"
                >
                    <v-icon>{{ recordedSortOrder === 'episodeAsc' ? 'mdi-sort-numeric-ascending' : 'mdi-sort-numeric-descending' }}</v-icon>
                </v-btn>
            </div>

            <!-- 話数・放送種別の一括編集 -->
            <template v-if="isBulkMode === true">
                <v-card variant="outlined" class="mb-3">
                    <v-card-text class="pb-2">
                        <div class="d-flex align-center ga-2 flex-wrap mb-2">
                            <v-btn size="small" variant="text" @click="selectAllRecorded">すべて選択</v-btn>
                            <v-btn size="small" variant="text" :disabled="selectedRecordedIds.length === 0" @click="selectedRecordedIds = []">選択解除</v-btn>
                            <span class="text-caption text-grey">{{ selectedRecordedIds.length }} 件選択中</span>
                        </div>
                        <div class="d-flex align-center ga-2 flex-wrap">
                            <v-text-field
                                v-model.number="sequenceStart"
                                type="number"
                                label="開始話数"
                                density="compact"
                                hide-details
                                style="max-width: 120px"
                            ></v-text-field>
                            <v-btn size="small" variant="tonal" :disabled="selectedRecordedIds.length === 0" @click="applySequence">
                                選択に連番を振る (放送日時順)
                            </v-btn>
                            <v-divider vertical></v-divider>
                            <v-select
                                v-model="bulkAirType"
                                :items="airTypeItems"
                                item-title="title"
                                item-value="value"
                                label="放送種別"
                                density="compact"
                                hide-details
                                style="max-width: 160px"
                            ></v-select>
                            <v-btn size="small" variant="tonal" :disabled="selectedRecordedIds.length === 0" @click="applyAirType">選択に適用</v-btn>
                        </div>
                    </v-card-text>
                </v-card>

                <v-table density="compact">
                    <thead>
                        <tr>
                            <th style="width: 48px"></th>
                            <th :style="{ width: isMobile === true ? '64px' : '110px' }">話数</th>
                            <th>タイトル</th>
                            <th v-if="isMobile === false" style="width: 200px">放送局・放送日時</th>
                            <th :style="{ width: isMobile === true ? '96px' : '150px' }">放送種別</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in displayedRecorded" :key="item.recordedId">
                            <td>
                                <v-checkbox-btn v-model="selectedRecordedIds" :value="item.recordedId"></v-checkbox-btn>
                            </td>
                            <td>
                                <v-text-field
                                    v-model.number="edits[item.recordedId].episodeNumber"
                                    type="number"
                                    density="compact"
                                    variant="outlined"
                                    hide-details
                                    clearable
                                    :class="{ 'text-primary': isEdited(item) }"
                                ></v-text-field>
                            </td>
                            <td class="text-truncate" style="max-width: 1px">
                                {{ item.episodeTitle || item.recordedTitle }}
                                <div v-if="isMobile === true" class="text-caption text-medium-emphasis">{{ item.channelName || item.channelId }} / {{ formatDate(item.startAt) }}</div>
                            </td>
                            <td v-if="isMobile === false" class="text-caption">{{ item.channelName || item.channelId }}<br />{{ formatDate(item.startAt) }}</td>
                            <td>
                                <v-select
                                    v-model="edits[item.recordedId].airType"
                                    :items="airTypeItems"
                                    item-title="title"
                                    item-value="value"
                                    density="compact"
                                    variant="outlined"
                                    hide-details
                                ></v-select>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
                <div class="d-flex align-center ga-2 mt-3">
                    <v-btn color="primary" :loading="bulkSaving" :disabled="changedItems.length === 0" @click="saveBulk">
                        変更を保存 ({{ changedItems.length }} 件)
                    </v-btn>
                    <v-btn variant="text" @click="cancelBulkEdit">キャンセル</v-btn>
                </div>
            </template>

            <v-list v-else lines="three">
                <v-list-item v-for="item in displayedRecorded" :key="item.recordedId" :to="isSplitMode === true ? undefined : `/recorded/detail/${item.recordedId}`">
                    <template #prepend>
                        <v-checkbox v-if="isSplitMode === true" v-model="selectedRecordedIds" :value="item.recordedId" hide-details density="compact"></v-checkbox>
                        <v-avatar v-else color="primary">{{ item.episodeNumber ?? '-' }}</v-avatar>
                    </template>
                    <v-list-item-title>{{ episodeTitle(item) }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                    <v-list-item-subtitle v-if="item.episodeComment" class="episode-comment">
                        <v-icon size="x-small">mdi-comment-text-outline</v-icon>
                        <SyobocalComment :comment="item.episodeComment" class="d-inline-block"></SyobocalComment>
                        <v-chip v-if="item.episodeCommentSource === 'manual'" class="ml-1" size="x-small" color="primary">手動</v-chip>
                    </v-list-item-subtitle>
                    <template #append>
                        <v-chip v-if="item.airType === 'rerun'" color="orange" size="small">再放送</v-chip>
                        <v-chip v-else-if="item.airType === 'delayed'" color="purple" size="small">遅れ放送</v-chip>
                        <v-chip v-else-if="isDuplicate(item.recordedId)" color="blue" size="small">複数録画</v-chip>
                        <!-- 話数が未確定の録画はエピソード行が無いのでコメントを付けられない -->
                        <v-btn
                            v-if="isSplitMode === false && item.episodeId !== null"
                            icon
                            variant="text"
                            size="small"
                            title="放送回コメントを編集"
                            @click.prevent.stop="openEpisodeCommentDialog(item)"
                        >
                            <v-icon size="small">mdi-comment-edit-outline</v-icon>
                        </v-btn>
                    </template>
                </v-list-item>
            </v-list>
            <v-alert v-if="detail.recorded.length === 0" type="info">この放送局の録画はありません</v-alert>

            <v-card v-if="isSplitMode === true" class="mt-3" variant="outlined">
                <v-card-text>
                    <v-text-field v-model="splitNewTitle" label="新しいシリーズ名"></v-text-field>
                    <v-btn color="primary" :loading="splitting" :disabled="selectedRecordedIds.length === 0 || !splitNewTitle" @click="isOpenConfirmSplitDialog = true"
                        >選択した {{ selectedRecordedIds.length }} 件を新しいシリーズに分割</v-btn
                    >
                </v-card-text>
            </v-card>
        </v-container>

        <!-- 作品コメントの編集 -->
        <v-dialog v-model="isOpenCommentDialog" max-width="700">
            <v-card>
                <v-card-title>作品コメントの編集</v-card-title>
                <v-card-text>
                    <v-textarea v-model="commentInput" rows="12" auto-grow hide-details label="コメント"></v-textarea>
                    <div class="text-caption text-grey mt-2">保存すると出所が「手動」になり、以降しょぼいカレンダーの値で上書きされなくなります</div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenCommentDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="commentSaving" @click="saveComment">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="isOpenDeleteCommentDialog" max-width="500">
            <v-card>
                <v-card-title>作品コメントの削除</v-card-title>
                <v-card-text>作品コメントを削除します。以降しょぼいカレンダーから自動で取得し直すこともありません。よろしいですか？</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenDeleteCommentDialog = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" :loading="commentSaving" @click="deleteComment">削除する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- 放送回コメントの編集 -->
        <v-dialog v-model="isOpenEpisodeCommentDialog" max-width="600">
            <v-card>
                <v-card-title>放送回コメントの編集</v-card-title>
                <v-card-text>
                    <div class="text-subtitle-2 mb-2">{{ episodeCommentTargetTitle }}</div>
                    <v-textarea v-model="episodeCommentInput" rows="4" auto-grow hide-details label="コメント (空にすると削除)"></v-textarea>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenEpisodeCommentDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="episodeCommentSaving" @click="saveEpisodeComment">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="isOpenConfirmSplitDialog" max-width="500">
            <v-card>
                <v-card-title>分割の確認</v-card-title>
                <v-card-text>選択した {{ selectedRecordedIds.length }} 件の録画を「{{ splitNewTitle }}」という新しいシリーズへ切り出します。よろしいですか？</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenConfirmSplitDialog = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" :loading="splitting" @click="executeSplit">実行する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- このシリーズの録画をまとめて再問い合わせする -->
        <v-dialog v-model="isOpenReanalyzeDialog" max-width="560">
            <v-card>
                <v-card-title>録画を再問い合わせ</v-card-title>
                <v-card-text>
                    <p class="mb-3">
                        このシリーズに紐づく {{ detail?.recordedCount ?? 0 }} 件の録画について、外部データ (しょぼいカレンダーの放送予定 / 作品辞書) から情報を引き直します。
                    </p>
                    <ul class="text-body-2 mb-3 pl-4">
                        <li>各録画の話数・サブタイトル・放送種別 (初回 / 再放送 / 遅れ放送)</li>
                        <li>シリーズの表示名・クール・読み仮名・総話数・外部 ID・作品コメント</li>
                    </ul>
                    <v-checkbox
                        v-model="reanalyzeRefreshMetadata"
                        label="シリーズのメタデータも引き直す"
                        density="compact"
                        hide-details
                        class="mb-2"
                    ></v-checkbox>
                    <v-alert type="info" density="compact" variant="tonal">
                        手動で確定した録画と、手動で設定したシリーズ名・クール・コメントは書き換えません。判定の結果、別のシリーズへ移る録画もあります
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenReanalyzeDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="reanalyzing" @click="executeReanalyze">実行する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>
<script lang="ts">
import SeriesExternalLinks from '@/components/series/SeriesExternalLinks.vue';
import SeriesTitleDisplayMenu from '@/components/series/SeriesTitleDisplayMenu.vue';
import SyobocalComment from '@/components/series/SyobocalComment.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, {
    SeriesDetail as Detail,
    SeriesRecording,
    MissingEpisodeProposal,
    SeriesBackfillResult,
} from '@/model/api/series/ISeriesApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import SeriesDisplay from '@/util/SeriesDisplay';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import * as apid from '../../../api';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 一括編集中の 1 行分の値
 */
interface BulkEdit {
    episodeNumber: number | null;
    airType: apid.SeriesAirType;
}

@Component({ components: { TitleBar, SeriesTitleDisplayMenu, SeriesExternalLinks, SyobocalComment } })
class SeriesDetailView extends Vue {
    // 録画の再問い合わせ後に進捗を見に行く間隔と回数 (最大 2 分待って終わらなければ画面更新だけ行う)
    private static readonly BACKFILL_POLL_INTERVAL_MS = 2000;
    private static readonly BACKFILL_POLL_MAX = 60;

    // スマホ・タブレットでは一括編集テーブルの列幅を縮め、放送局・放送日時列をタイトル下にまとめる
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    detail: Detail | null = null;
    channelId: number | null = null;
    annictSyncing = false;
    metadataSyncing = false;
    isOpenReanalyzeDialog = false;
    reanalyzing = false;
    // 再解析時にシリーズのメタデータも引き直すか (録画側の再判定は常に行う)
    reanalyzeRefreshMetadata = true;
    annictMessage = '';
    futureProposals: MissingEpisodeProposal[] = [];
    reservingKey: string | null = null;

    isOpenCommentDialog = false;
    isOpenDeleteCommentDialog = false;
    commentInput = '';
    commentSaving = false;

    // 放送回コメント
    isOpenEpisodeCommentDialog = false;
    episodeCommentInput = '';
    episodeCommentSaving = false;
    episodeCommentTargetId: number | null = null;
    episodeCommentTargetTitle = '';

    isSplitMode = false;
    selectedRecordedIds: number[] = [];
    splitNewTitle = '';
    splitting = false;
    isOpenConfirmSplitDialog = false;

    isBulkMode = false;
    // 録画 ID → 編集中の話数・放送種別。保存時に元の値と比べて差分だけ送る
    edits: Record<number, BulkEdit> = {};
    sequenceStart = 1;
    bulkAirType: apid.SeriesAirType = 'delayed';
    bulkSaving = false;

    readonly airTypeItems = [
        { title: '初回', value: 'first' },
        { title: '再放送', value: 'rerun' },
        { title: '遅れ放送', value: 'delayed' },
        { title: '不明', value: 'unknown' },
    ];

    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    // メニュー側と同じ実体 (tmp) を参照し、変更が即座に見えるようにする
    private settingValue: ISettingValue = this.settingStorageModel.tmp;
    // 作品辞書由来のエピソード名を使うか (false の場合は録画タイトルをそのまま表示する)
    useDictionaryEpisodeTitle: boolean = this.settingValue.useDictionaryEpisodeTitle ?? true;
    get id() {
        return Number(this.$route.params.id);
    }
    /**
     * 概要ヘッダのクール表記
     */
    get seasonText(): string {
        return this.detail === null ? '-' : SeriesDisplay.seasonText(this.detail);
    }
    /**
     * 総話数が分かっている場合だけ「/ 全 N 話」を添える
     */
    get totalEpisodesText(): string {
        const total = this.detail?.totalEpisodes;
        return typeof total === 'number' && total > 0 ? ` / 全 ${total} 話` : '';
    }
    get fileSizeText(): string {
        return SeriesDisplay.fileSizeText(this.detail?.totalFileSize ?? 0);
    }
    get watchedPercent(): number {
        return this.detail === null ? 0 : SeriesDisplay.watchedPercent(this.detail);
    }
    get originText(): string {
        return SeriesDisplay.originText(this.detail ?? {});
    }
    get originColor(): string {
        return SeriesDisplay.originColor(this.detail ?? {});
    }
    get originTitle(): string {
        return SeriesDisplay.originTitle(this.detail ?? {});
    }
    get missingEpisodeText(): string {
        return this.detail?.continuity.missingEpisodes.map(x => `S${x.seasonNumber} 第${x.episodeNumber}話`).join('、') ?? '';
    }
    get duplicateEpisodeText(): string {
        return this.detail?.continuity.duplicateEpisodes.map(x => `S${x.seasonNumber} 第${x.episodeNumber}話 (${x.recordedIds.length}件)`).join('、') ?? '';
    }
    isDuplicate(recordedId: number): boolean {
        return this.detail?.continuity.duplicateEpisodes.some(x => x.recordedIds.includes(recordedId)) ?? false;
    }
    get channelItems() {
        return [
            { title: 'すべての放送局', value: null },
            ...(this.detail?.channels.map(x => ({ title: `${x.channelName || x.channelId} (${x.count})`, value: x.channelId })) || []),
        ];
    }

    // 録画再生画面のシリーズタブと同じ設定で、シリーズ内の録画表示順を切り替える
    get recordedSortOrder(): 'episodeAsc' | 'episodeDesc' {
        return this.settingStorageModel.tmp.nextUpSeriesSortOrder;
    }

    get displayedRecorded(): SeriesRecording[] {
        const recorded = [...(this.detail?.recorded ?? [])];
        return recorded.sort((a, b) => {
            const aHasEpisode = a.episodeNumber !== null;
            const bHasEpisode = b.episodeNumber !== null;
            if (aHasEpisode !== bHasEpisode) {
                return aHasEpisode === true ? -1 : 1;
            }

            const aSeason = a.seasonNumber ?? 1;
            const bSeason = b.seasonNumber ?? 1;
            const seasonDifference = aSeason - bSeason;
            if (seasonDifference !== 0) {
                return this.recordedSortOrder === 'episodeAsc' ? seasonDifference : -seasonDifference;
            }

            const aEpisode = a.episodeNumber ?? 0;
            const bEpisode = b.episodeNumber ?? 0;
            const difference = aEpisode === bEpisode ? a.startAt - b.startAt : aEpisode - bEpisode;
            return this.recordedSortOrder === 'episodeAsc' ? difference : -difference;
        });
    }

    toggleRecordedSortOrder(): void {
        this.settingStorageModel.tmp.nextUpSeriesSortOrder = this.recordedSortOrder === 'episodeAsc' ? 'episodeDesc' : 'episodeAsc';
        this.settingStorageModel.save();
    }

    mounted() {
        void this.load();
        void this.loadFutureProposals();
    }
    async syncAnnict(): Promise<void> {
        this.annictSyncing = true;
        this.annictMessage = '';
        try {
            const result = await this.api.syncAnnict(this.id);
            this.annictMessage = `Annict「${result.title}」に同期しました`;
            await this.load();
        } finally {
            this.annictSyncing = false;
        }
    }
    /**
     * このシリーズだけ作品辞書からメタデータ (表示名・クール・読み仮名・総話数・外部 ID・コメント) を取り直す
     */
    async refreshMetadata(): Promise<void> {
        this.metadataSyncing = true;
        try {
            const result = await this.api.refreshMetadata(this.id);
            await this.load();
            const detail =
                result.updated === 0
                    ? '更新はありません'
                    : result.keySynced > 0
                      ? 'シリーズ名と判定キーを辞書名へ同期しました'
                      : result.titleSynced > 0
                        ? 'シリーズ名を辞書名へ同期しました'
                        : 'メタデータを更新しました';
            this.snackbarState.open({ color: 'success', text: `辞書から再取得しました (${detail})` });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '辞書からの再取得に失敗しました' });
        } finally {
            this.metadataSyncing = false;
        }
    }
    /**
     * このシリーズの録画をまとめてシリーズ判定にかけ直す。
     * 録画側の判定は Operator でバックグラウンドに進むため、終わるまで進捗を見て画面を更新する
     */
    async executeReanalyze(): Promise<void> {
        this.reanalyzing = true;
        try {
            const result = await this.api.reanalyze({
                seriesIds: [this.id],
                refreshMetadata: this.reanalyzeRefreshMetadata,
            });
            this.isOpenReanalyzeDialog = false;
            this.snackbarState.open({
                color: 'success',
                text: `録画 ${result.backfill.total} 件の再問い合わせを開始しました`,
            });
            const status = await this.waitForBackfill();
            await this.load();
            await this.loadFutureProposals();
            if (status !== null) {
                this.snackbarState.open({
                    color: 'success',
                    text: `再問い合わせが完了しました (${status.processed} 件処理、${status.linked} 件更新)`,
                });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '録画の再問い合わせに失敗しました' });
        } finally {
            this.reanalyzing = false;
        }
    }

    /**
     * バックフィル (録画の再判定) が終わるまで進捗を見に行く。
     * 上限まで待っても終わらない場合は null を返し、画面の更新だけ行う (処理自体は続く)
     * @return Promise<SeriesBackfillResult | null>
     */
    private async waitForBackfill(): Promise<SeriesBackfillResult | null> {
        for (let i = 0; i < SeriesDetailView.BACKFILL_POLL_MAX; i++) {
            await new Promise(resolve => setTimeout(resolve, SeriesDetailView.BACKFILL_POLL_INTERVAL_MS));
            const status = await this.api.getBackfillStatus().catch(() => null);
            if (status === null) return null;
            if (status.state !== 'running') return status;
        }

        return null;
    }

    async load() {
        this.detail = await this.api.get(this.id, this.channelId ?? undefined);
    }
    /**
     * 作品コメントの編集ダイアログを開く
     */
    openCommentDialog(): void {
        this.commentInput = this.detail?.comment ?? '';
        this.isOpenCommentDialog = true;
    }
    /**
     * 作品コメントを保存する (空文字の場合は削除される)
     */
    async saveComment(): Promise<void> {
        this.commentSaving = true;
        try {
            const comment = this.commentInput.trim();
            await this.api.updateSeriesMetadata(this.id, { comment: comment === '' ? null : comment });
            this.isOpenCommentDialog = false;
            await this.load();
            this.snackbarState.open({ color: 'success', text: '作品コメントを保存しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '作品コメントの保存に失敗しました' });
        } finally {
            this.commentSaving = false;
        }
    }
    /**
     * 作品コメントを削除する
     */
    async deleteComment(): Promise<void> {
        this.commentSaving = true;
        try {
            await this.api.updateSeriesMetadata(this.id, { comment: null });
            this.isOpenDeleteCommentDialog = false;
            await this.load();
            this.snackbarState.open({ color: 'success', text: '作品コメントを削除しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '作品コメントの削除に失敗しました' });
        } finally {
            this.commentSaving = false;
        }
    }
    /**
     * 放送回コメントの編集ダイアログを開く
     * @param item: SeriesRecording 対象の録画行
     */
    openEpisodeCommentDialog(item: SeriesRecording): void {
        if (item.episodeId === null) return;
        this.episodeCommentTargetId = item.episodeId;
        this.episodeCommentTargetTitle = this.episodeTitle(item);
        this.episodeCommentInput = item.episodeComment ?? '';
        this.isOpenEpisodeCommentDialog = true;
    }
    /**
     * 放送回コメントを保存する (空文字の場合は削除される)
     */
    async saveEpisodeComment(): Promise<void> {
        if (this.episodeCommentTargetId === null) return;
        this.episodeCommentSaving = true;
        try {
            const comment = this.episodeCommentInput.trim();
            await this.api.updateEpisodeComment(this.episodeCommentTargetId, comment === '' ? null : comment);
            this.isOpenEpisodeCommentDialog = false;
            await this.load();
            this.snackbarState.open({ color: 'success', text: '放送回コメントを保存しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '放送回コメントの保存に失敗しました' });
        } finally {
            this.episodeCommentSaving = false;
        }
    }
    async loadFutureProposals(): Promise<void> {
        try {
            this.futureProposals = await this.api.getMissingEpisodeProposals(this.id);
        } catch (err) {
            // 欠番補完提案の取得に失敗しても致命的ではないため一覧表示のみ諦める
            console.error(err);
        }
    }
    async reserveProposal(p: MissingEpisodeProposal, c: MissingEpisodeProposal['candidates'][number]): Promise<void> {
        const key = `${p.seasonNumber}-${p.episodeNumber}-${c.programId}`;
        this.reservingKey = key;
        try {
            await this.api.reserveMissingEpisode(this.id, p.seasonNumber, p.episodeNumber, c.programId);
            this.snackbarState.open({ color: 'success', text: `${c.name} を予約しました` });
            await this.loadFutureProposals();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '予約に失敗しました' });
        } finally {
            this.reservingKey = null;
        }
    }
    episodeTitle(x: SeriesRecording) {
        if (this.useDictionaryEpisodeTitle === false) {
            return x.recordedTitle;
        }
        const label = x.episodeLabel ?? (x.episodeNumber !== null ? `第${x.episodeNumber}話` : '');
        return `${label} ${x.episodeTitle || x.recordedTitle}`.trim();
    }
    /**
     * エピソード名の表示方法 (辞書名 / 録画タイトル) が変わったときに反映する
     */
    onChangedTitleDisplay(): void {
        this.useDictionaryEpisodeTitle = this.settingValue.useDictionaryEpisodeTitle ?? true;
    }
    formatDate(value: number) {
        return new Date(value).toLocaleString();
    }
    /**
     * 概要ヘッダの日付表記 (時刻は出さない)
     */
    formatDay(value: number): string {
        return new Date(value).toLocaleDateString();
    }
    /**
     * 話数・放送種別の一括編集を開始する。現在の値を編集用のバッファへ写す
     */
    startBulkEdit(): void {
        this.isBulkMode = true;
        this.selectedRecordedIds = [];
        this.resetEdits();
    }
    cancelBulkEdit(): void {
        this.isBulkMode = false;
        this.selectedRecordedIds = [];
        this.edits = {};
    }
    private resetEdits(): void {
        const edits: Record<number, BulkEdit> = {};
        for (const item of this.detail?.recorded ?? []) {
            edits[item.recordedId] = {
                episodeNumber: item.episodeNumber,
                airType: (item.airType || 'unknown') as apid.SeriesAirType,
            };
        }
        this.edits = edits;
    }
    selectAllRecorded(): void {
        this.selectedRecordedIds = (this.detail?.recorded ?? []).map(x => x.recordedId);
    }
    /**
     * 選択した録画を放送日時の古い順に並べ、開始話数から連番を振る
     */
    applySequence(): void {
        const start = Number(this.sequenceStart);
        if (Number.isFinite(start) === false) {
            this.snackbarState.open({ color: 'error', text: '開始話数を入力してください' });
            return;
        }
        const targets = (this.detail?.recorded ?? [])
            .filter(x => this.selectedRecordedIds.includes(x.recordedId))
            .sort((a, b) => a.startAt - b.startAt);
        targets.forEach((x, index) => {
            this.edits[x.recordedId].episodeNumber = start + index;
        });
    }
    /**
     * 選択した録画の放送種別 (遅れ放送・再放送など) をまとめて設定する
     */
    applyAirType(): void {
        for (const id of this.selectedRecordedIds) {
            if (typeof this.edits[id] !== 'undefined') this.edits[id].airType = this.bulkAirType;
        }
    }
    isEdited(item: SeriesRecording): boolean {
        const edit = this.edits[item.recordedId];
        if (typeof edit === 'undefined') return false;
        return edit.episodeNumber !== item.episodeNumber || edit.airType !== (item.airType || 'unknown');
    }
    /**
     * 元の値から変わった行だけを送信対象にする
     */
    get changedItems(): apid.BulkSeriesMappingItem[] {
        return (this.detail?.recorded ?? []).filter(x => this.isEdited(x)).map(x => {
            const edit = this.edits[x.recordedId];
            // 空欄 (NaN や空文字) は「話数なし」として null で送る
            const episodeNumber =
                typeof edit.episodeNumber === 'number' && Number.isFinite(edit.episodeNumber)
                    ? edit.episodeNumber
                    : null;
            return {
                recordedId: x.recordedId,
                seasonNumber: x.seasonNumber ?? 1,
                episodeNumber,
                airType: edit.airType,
            };
        });
    }
    async saveBulk(): Promise<void> {
        const items = this.changedItems;
        if (items.length === 0) return;
        this.bulkSaving = true;
        try {
            const result = await this.api.updateMappingBulk(items);
            if (result.failed.length > 0) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${result.updated} 件を更新しましたが ${result.failed.length} 件失敗しました`,
                });
                console.error(result.failed);
            } else {
                this.snackbarState.open({ color: 'success', text: `${result.updated} 件を更新しました` });
            }
            await this.load();
            this.resetEdits();
            this.selectedRecordedIds = [];
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '一括更新に失敗しました' });
        } finally {
            this.bulkSaving = false;
        }
    }
    cancelSplit(): void {
        this.isSplitMode = false;
        this.selectedRecordedIds = [];
        this.splitNewTitle = '';
    }
    async executeSplit(): Promise<void> {
        this.splitting = true;
        try {
            const result = await this.api.split(this.id, this.selectedRecordedIds, this.splitNewTitle);
            this.isOpenConfirmSplitDialog = false;
            this.snackbarState.open({ color: 'success', text: `「${result.title}」として分割しました` });
            this.cancelSplit();
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '分割に失敗しました' });
        } finally {
            this.splitting = false;
        }
    }
}
export default toNative(SeriesDetailView);
</script>
<style lang="scss" scoped>
.episode-comment {
    white-space: pre-wrap;
}

// 概要ヘッダ: 横並びのときだけ画像の幅を固定し、情報側を伸ばす
.series-hero {
    &__image {
        flex: 0 0 auto;
        width: 100%;
    }

    &__body {
        min-width: 0;
        flex: 1 1 auto;
    }

    &__meta {
        display: flex;
        flex-wrap: wrap;
        column-gap: 16px;
        row-gap: 4px;
    }
}

@media (min-width: 600px) {
    .series-hero__image {
        width: 280px;
    }
}
</style>
