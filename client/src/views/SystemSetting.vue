<template>
    <v-main>
        <TitleBar title="サーバー設定"></TitleBar>
        <v-container fluid>
            <v-alert v-if="requiresRestartKeys.length > 0" type="warning" closable class="mb-4" @click:close="requiresRestartKeys = []">
                再起動が必要です ({{ requiresRestartKeys.join('、') }})。変更を反映するには Operator プロセスの再起動が必要です。
            </v-alert>
            <v-card>
                <v-tabs v-model="tab" show-arrows>
                    <v-tab value="basic">基本</v-tab>
                    <v-tab value="integration">連携</v-tab>
                    <v-tab value="notification">通知</v-tab>
                    <v-tab value="series">シリーズ管理</v-tab>
                    <v-tab value="config">設定ファイル</v-tab>
                    <v-tab v-if="isUpdateEnabled === true" value="update">更新</v-tab>
                    <v-tab v-if="isAuthEnabled === true" value="account">アカウント</v-tab>
                </v-tabs>
                <v-card-text>
                    <v-window v-model="tab">
                        <!-- 基本タブ: 変更履歴・ロールバック -->
                        <v-window-item value="basic">
                            <div class="text-subtitle-1 mb-2">変更履歴・ロールバック</div>
                            <v-select v-model="historyKey" :items="historyKeyItems" item-title="title" label="対象キー" v-on:update:model-value="loadHistory"></v-select>
                            <v-alert v-if="historyItems.length === 0" type="info" class="mb-2">変更履歴はありません</v-alert>
                            <v-table v-else density="compact" class="mb-2">
                                <thead>
                                    <tr>
                                        <th>日時</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="h in historyItems" :key="h.id">
                                        <td>{{ formatDate(h.updatedAt) }}</td>
                                    </tr>
                                </tbody>
                            </v-table>
                            <v-btn variant="outlined" color="error" :disabled="historyItems.length === 0" :loading="rollbacking" @click="rollback">直前の状態へロールバック</v-btn>
                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">ログレベル</div>
                            <div class="text-caption mb-2">
                                config/*LogConfig.yml の設定を上書きします。保存すると再起動なしで即座に反映されます (指定しなかったカテゴリはファイルの設定のまま)
                            </div>
                            <div class="d-flex ga-2 flex-wrap">
                                <v-select
                                    v-for="c in logCategories"
                                    :key="c.value"
                                    v-model="settings.logging.levels[c.value]"
                                    :items="logLevelItems"
                                    item-title="title"
                                    item-value="value"
                                    :label="c.title"
                                    density="compact"
                                    hide-details
                                    clearable
                                    style="max-width: 180px"
                                ></v-select>
                            </div>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">録画ファイルのメタデータ</div>
                            <div class="text-caption mb-2">
                                ffprobe で録画ファイルの実尺・開始位置・コーデック・解像度を取得して DB
                                に保存します。シークバーの全体長表示とニコニコ実況コメントの時刻合わせに利用されます (サーバー起動時にもバックグラウンドで実行されます)。
                            </div>
                            <div class="text-body-2 mb-2">
                                総数 {{ videoMetadataStatus.total }} 件 / 解析済み {{ videoMetadataStatus.analyzed }} 件 / 未解析 {{ videoMetadataStatus.unanalyzed }} 件
                            </div>
                            <div class="d-flex ga-2 flex-wrap">
                                <v-btn variant="outlined" :loading="videoMetadataLoading" @click="loadVideoMetadataStatus">再読み込み</v-btn>
                                <v-btn
                                    color="primary"
                                    :disabled="isAnalyzeJobRunning === true || videoMetadataStatus.unanalyzed === 0"
                                    @click="startAnalyzeJob('metadata', 'unanalyzed')"
                                >
                                    未解析ファイルを一括取得
                                </v-btn>
                                <v-btn color="secondary" variant="outlined" :disabled="isAnalyzeJobRunning === true" @click="startAnalyzeJob('metadata', 'all')">
                                    全件を強制再解析
                                </v-btn>
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">
                                「全件を強制再解析」は解析済みのファイルも含めてすべて取得し直します (件数が多いと時間がかかります)。
                            </div>
                            <div v-if="analyzeJobOf('metadata') !== null" class="mt-2">
                                <v-progress-linear :model-value="analyzeJobPercent" color="primary" height="6" rounded class="mb-1"></v-progress-linear>
                                <div class="d-flex align-center ga-2 flex-wrap">
                                    <span class="text-body-2">{{ analyzeJobText }}</span>
                                    <v-btn v-if="isAnalyzeJobRunning === true" size="small" variant="text" color="error" @click="cancelAnalyzeJob">中断</v-btn>
                                </div>
                            </div>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">録画ファイルの TS 解析</div>
                            <div class="text-caption mb-2">
                                TS の PSI/SI (SDT / EIT / TDT) から放送局名・番組名・概要・ジャンル・映像音声情報・録画開始時刻を取得して DB
                                に保存します。取り込んだ外部ファイルの放送局特定や、ニコニコ実況コメントの時刻合わせに利用されます (取り込み時には自動で実行されます)。
                                過去に取り込んだ録画で番組情報が空のままのものは「全件を強制再解析」で埋められます (すでに値がある項目は上書きしません)。録画 1 件だけなら録画詳細のメニューから再解析できます。
                            </div>
                            <div class="text-body-2 mb-2">
                                TS ファイル {{ tsInfoStatus.total }} 件 / 解析済み {{ tsInfoStatus.analyzed }} 件 / 未解析 {{ tsInfoStatus.unanalyzed }} 件
                            </div>
                            <div class="d-flex ga-2 flex-wrap align-center">
                                <v-btn variant="outlined" :loading="tsInfoLoading" @click="loadTsInfoStatus">再読み込み</v-btn>
                                <v-btn color="primary" :disabled="isAnalyzeJobRunning === true || tsInfoStatus.unanalyzed === 0" @click="startAnalyzeJob('tsInfo', 'unanalyzed')">
                                    未解析ファイルを一括解析
                                </v-btn>
                                <v-btn color="secondary" variant="outlined" :disabled="isAnalyzeJobRunning === true" @click="startAnalyzeJob('tsInfo', 'all')">
                                    全件を強制再解析
                                </v-btn>
                                <v-btn variant="outlined" :disabled="isAnalyzeJobRunning === true" @click="startAnalyzeJob('channel', 'all')">解析結果から放送局を反映</v-btn>
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">
                                「全件を強制再解析」は解析済みのファイルも含めてすべて解析し直します。TS 解析ロジックの更新を既存ファイルへ反映したい場合に使ってください
                                (件数が多いと時間がかかります)。
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">
                                「解析結果から放送局を反映」は、保存済みの TS 解析結果 (SDT)
                                から放送局が不明な録画の局名を埋め直します。ファイルは読み直さないため短時間で終わります。
                            </div>
                            <div v-if="analyzeJobOf('tsInfo') !== null || analyzeJobOf('channel') !== null" class="mt-2">
                                <v-progress-linear :model-value="analyzeJobPercent" color="primary" height="6" rounded class="mb-1"></v-progress-linear>
                                <div class="d-flex align-center ga-2 flex-wrap">
                                    <span class="text-body-2">{{ analyzeJobText }}</span>
                                    <v-btn v-if="isAnalyzeJobRunning === true" size="small" variant="text" color="error" @click="cancelAnalyzeJob">中断</v-btn>
                                </div>
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">解析はサーバー側で進みます。この画面を閉じても処理は続き、開き直せば進捗の続きが表示されます。</div>

                            <v-divider class="my-4"></v-divider>
                            <v-alert type="info">
                                現在、再起動 (Operator 再初期化) が必須の設定項目はありません。今後追加された場合、このタブと画面上部のバナーで通知されます。
                            </v-alert>
                        </v-window-item>

                        <!-- 連携タブ -->
                        <v-window-item value="integration">
                            <div class="text-subtitle-1 mb-2">Annict 連携</div>
                            <v-switch v-model="settings.metadata.annict.enabled" label="Annict連携を有効化"></v-switch>
                            <v-text-field
                                v-model="settings.metadata.annict.token"
                                label="Annictアクセストークン"
                                type="password"
                                autocomplete="new-password"
                                hint="サーバーに保存済みの値はマスクして表示されます。変更する場合のみ新しい値を入力してください"
                                persistent-hint
                            ></v-text-field>
                            <div class="d-flex align-center ga-2 my-2">
                                <v-btn variant="outlined" :loading="annictTesting" @click="testAnnictConnection">接続テスト</v-btn>
                                <span v-if="annictTestResult" class="text-body-2">{{ annictTestResult }}</span>
                            </div>
                            <v-alert type="info" density="compact" class="mb-2">
                                接続テストは
                                <b>保存済みの設定</b>
                                に対して行われます。スイッチやトークンを変更したら、先に画面下部の「保存」を押してください。
                            </v-alert>

                            <v-switch v-model="settings.metadata.annict.syncEnabled" label="視聴記録の自動同期" :disabled="isEnabledAnnictSyncFeature === false"></v-switch>
                            <div class="text-subtitle-2 mt-2 mb-2">作品辞書</div>
                            <v-alert type="info" density="compact" class="mb-2">
                                Annict から全作品を取得し、しょぼいカレンダー辞書と統合してシリーズ照合に使います。英題・ローマ字・かな表記を照合キーに加えられるほか、Annict が持つ
                                <code>syobocalTid</code>
                                でしょぼいカレンダー作品と厳密に結び付けられます。Annict 連携が有効かつトークンが設定されている場合のみ動作します。
                            </v-alert>
                            <div class="text-body-2 mb-2">
                                登録作品数: {{ annictWorkStatus === null ? '未取得' : annictWorkStatus.workCount.toLocaleString() }}
                                <span v-if="annictWorkStatus !== null">/ しょぼいカレンダーと結合済: {{ annictWorkStatus.linkedToSyobocalCount.toLocaleString() }}</span>
                            </div>
                            <div class="d-flex align-center ga-2 mb-2 flex-wrap">
                                <v-btn variant="outlined" :loading="annictWorkSyncing" @click="syncAnnictWorks">作品辞書を同期</v-btn>
                                <span v-if="annictWorkSyncResult" class="text-body-2">{{ annictWorkSyncResult }}</span>
                            </div>
                            <v-text-field
                                v-model.number="settings.metadata.annict.workSyncIntervalMs"
                                type="number"
                                label="作品辞書の自動同期間隔 (ms, 0 で自動同期しない)"
                                density="compact"
                            ></v-text-field>

                            <v-alert type="info" density="compact" class="mb-4">
                                視聴記録の自動同期には二重のゲートがあります。(1) サーバー設定 (featureFlags.annictSync, config.yml): 現在
                                {{ isEnabledAnnictSyncFeature ? '有効' : '無効 (WebUI からは変更できません)' }}。(2) 上記のスイッチ
                                (この画面から変更可能)。両方が有効な場合のみ同期が動作します。
                            </v-alert>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">しょぼいカレンダー連携</div>
                            <v-switch v-model="settings.metadata.syobocal.enabled" label="しょぼいカレンダー連携を有効化"></v-switch>

                            <div class="text-subtitle-2 mt-2 mb-2">アニメ作品タイトル辞書</div>
                            <v-alert type="info" density="compact" class="mb-2">
                                しょぼいカレンダーからアニメ作品タイトルを一括取得し、シリーズ自動マッピングの照合辞書として使います。放送局ごとの表記ゆれ
                                (「第壱話」「break1」「TVアニメ『◯◯』」「水曜アニメ・」など) があっても同じ作品としてまとめられます。
                            </v-alert>
                            <div class="text-body-2 mb-2">
                                登録作品数: {{ syobocalTitleStatus === null ? '取得中…' : syobocalTitleStatus.titleCount.toLocaleString() }}
                                <span v-if="syobocalTitleStatus !== null && syobocalTitleStatus.lastUpdate !== null">/ 最終更新: {{ syobocalTitleStatus.lastUpdate }}</span>
                            </div>
                            <div class="d-flex align-center ga-2 mb-2 flex-wrap">
                                <v-btn variant="outlined" :loading="syobocalTitleSyncing" @click="syncSyobocalTitles(false)">差分同期</v-btn>
                                <v-btn variant="outlined" :loading="syobocalTitleSyncing" @click="syncSyobocalTitles(true)">全件取り直し</v-btn>
                                <span v-if="syobocalTitleSyncResult" class="text-body-2">{{ syobocalTitleSyncResult }}</span>
                            </div>
                            <v-text-field
                                v-model.number="settings.metadata.syobocal.titleSyncIntervalMs"
                                type="number"
                                label="辞書の自動同期間隔 (ms, 0 で自動同期しない)"
                                density="compact"
                            ></v-text-field>

                            <div class="d-flex align-center mb-2 mt-2">
                                <div class="text-subtitle-2">チャンネルマッピング表 (未登録局フラグ含む)</div>
                                <v-spacer></v-spacer>
                                <v-btn size="small" variant="outlined" color="primary" @click="addChannelMapEntry">追加</v-btn>
                            </div>
                            <v-alert type="info" density="compact" class="mb-2">
                                同梱データ・共有静的データ・
                                <code>metadataChannelMappingPath</code>
                                より、この一覧の設定が優先されます。
                            </v-alert>
                            <v-alert v-if="channelMapEntries.length === 0" type="info" class="mb-2">追加登録されたマッピングはありません</v-alert>
                            <v-card v-for="(entry, index) in channelMapEntries" :key="entry.__key" variant="outlined" class="mb-2 pa-2">
                                <div class="d-flex align-center ga-2 flex-wrap">
                                    <v-select
                                        v-model="entry.__channelId"
                                        :items="channelSelectItems"
                                        item-title="title"
                                        label="チャンネルから選択"
                                        density="compact"
                                        hide-details
                                        style="min-width: 220px"
                                        v-on:update:model-value="onChannelSelected(entry, $event)"
                                    ></v-select>
                                    <v-text-field
                                        v-model.number="entry.chId"
                                        type="number"
                                        label="しょぼいカレンダー ChID"
                                        density="compact"
                                        hide-details
                                        style="max-width: 160px"
                                    ></v-text-field>
                                    <v-text-field
                                        v-model.number="entry.networkId"
                                        type="number"
                                        label="networkId"
                                        density="compact"
                                        hide-details
                                        style="max-width: 140px"
                                    ></v-text-field>
                                    <v-text-field
                                        v-model.number="entry.serviceId"
                                        type="number"
                                        label="serviceId"
                                        density="compact"
                                        hide-details
                                        style="max-width: 140px"
                                    ></v-text-field>
                                    <v-switch v-model="entry.syobocal" label="しょぼいカレンダー登録局" density="compact" hide-details></v-switch>
                                    <v-btn icon variant="text" color="error" @click="removeChannelMapEntry(index)"><v-icon>mdi-delete</v-icon></v-btn>
                                </div>
                            </v-card>
                            <v-btn size="small" variant="outlined" color="primary" :loading="channelMapSaving" @click="saveChannelMap">マッピング表を保存</v-btn>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">共有静的データ</div>
                            <v-switch v-model="settings.metadata.sharedData.autoUpdate" label="共有静的データの自動更新"></v-switch>
                            <div class="d-flex align-center ga-2 mb-2">
                                <v-btn variant="outlined" :loading="sharedDataSyncing" @click="syncSharedDataNow">今すぐ同期</v-btn>
                                <span v-if="sharedDataSyncResult" class="text-body-2">{{ sharedDataSyncResult }}</span>
                            </div>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">外部サービスのエンドポイント</div>
                            <v-alert type="info" density="compact" class="mb-2">
                                Cloudflare Workers などのキャッシュ/プロキシを手前に置く場合に差し替えます。空欄のままなら括弧内の既定値を使います。
                                <b>プロキシは元サービスと同じパス・クエリ・レスポンス形式をそのまま返す必要があります。</b>
                                http / https 以外の URL は無視され既定値にフォールバックします。
                            </v-alert>
                            <v-text-field
                                v-model="settings.metadata.endpoints.syobocal"
                                label="しょぼいカレンダー DB API"
                                placeholder="https://cal.syoboi.jp/db.php"
                                persistent-placeholder
                                density="compact"
                            ></v-text-field>
                            <v-text-field
                                v-model="settings.metadata.endpoints.annict"
                                label="Annict GraphQL API"
                                placeholder="https://api.annict.com/graphql"
                                persistent-placeholder
                                density="compact"
                            ></v-text-field>
                            <v-text-field
                                v-model="settings.metadata.endpoints.fxtwitter"
                                label="fxtwitter JSON API (Twitter アバター解決用)"
                                placeholder="https://api.fxtwitter.com/"
                                persistent-placeholder
                                density="compact"
                            ></v-text-field>
                            <v-text-field
                                v-model="settings.metadata.endpoints.sharedData"
                                label="共有静的データ URL (チャンネルマッピング表等)"
                                placeholder="未設定 (config.yml の metadataSharedDataUrl を使用)"
                                persistent-placeholder
                                density="compact"
                            ></v-text-field>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">メタデータキャッシュ</div>
                            <v-text-field
                                v-model.number="settings.metadata.cacheTtlMs"
                                type="number"
                                label="キャッシュ有効期間 (ms)"
                                hint="外部メタデータ検索結果のキャッシュ有効期間"
                                persistent-hint
                            ></v-text-field>
                        </v-window-item>

                        <!-- 通知タブ -->
                        <v-window-item value="notification">
                            <v-switch v-model="settings.notifications.enabled" label="通知を有効化"></v-switch>
                            <v-row>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.maxAttempts" type="number" label="最大リトライ回数"></v-text-field>
                                </v-col>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.baseDelayMs" type="number" label="リトライ基準遅延 (ms)"></v-text-field>
                                </v-col>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.timeoutMs" type="number" label="タイムアウト (ms)"></v-text-field>
                                </v-col>
                            </v-row>

                            <div class="d-flex align-center mb-2">
                                <div class="text-subtitle-1">配信先一覧</div>
                                <v-spacer></v-spacer>
                                <v-btn size="small" variant="outlined" color="primary" @click="addNotificationTarget">配信先を追加</v-btn>
                            </div>
                            <v-alert v-if="settings.notifications.targets.length === 0" type="info" class="mb-2">配信先がありません。「配信先を追加」から追加してください</v-alert>
                            <v-card v-for="(target, index) in settings.notifications.targets" :key="target.__key" variant="outlined" class="mb-3 pa-3">
                                <div class="d-flex align-center ga-2">
                                    <v-text-field
                                        v-model="target.name"
                                        label="配信先名"
                                        density="compact"
                                        hide-details
                                        class="flex-grow-1"
                                        v-on:blur="onTargetNameChanged(target)"
                                    ></v-text-field>
                                    <v-btn icon variant="text" color="error" @click="removeNotificationTarget(index)"><v-icon>mdi-delete</v-icon></v-btn>
                                </div>
                                <v-alert v-if="target.__renamed === true" type="warning" density="compact" class="my-2">
                                    配信先名を変更すると、保存済みのシークレット (URL・署名シークレット) は引き継がれません。URL・シークレットを再入力してください
                                </v-alert>
                                <v-select v-model="target.type" :items="['discord', 'webhook']" label="種別" density="compact"></v-select>
                                <v-text-field v-model="target.url" label="Webhook URL" density="compact"></v-text-field>
                                <v-text-field
                                    v-if="target.type === 'webhook'"
                                    v-model="target.secret"
                                    type="password"
                                    label="署名シークレット（汎用Webhook）"
                                    density="compact"
                                    autocomplete="new-password"
                                ></v-text-field>
                                <v-select v-model="target.events" :items="notificationEventItems" label="通知イベント" multiple chips density="compact"></v-select>
                                <v-btn size="small" variant="outlined" :loading="testingTargetName === target.name" @click="testNotification(target.name)">
                                    この配信先へテスト通知
                                </v-btn>
                            </v-card>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">通知の失敗履歴 (リトライ上限到達)</div>
                            <v-btn size="small" variant="text" @click="loadNotificationFailures">再読み込み</v-btn>
                            <v-alert v-if="notificationFailures.length === 0" type="info" class="mt-2">失敗履歴はありません</v-alert>
                            <template v-else>
                                <v-table v-if="isMobile === false" density="compact">
                                    <thead>
                                        <tr>
                                            <th>配信先</th>
                                            <th>イベント</th>
                                            <th>試行回数</th>
                                            <th>最終エラー</th>
                                            <th>日時</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="f in notificationFailures" :key="f.id">
                                            <td>{{ f.targetName }}</td>
                                            <td>{{ f.eventType }}</td>
                                            <td>{{ f.attempts }}</td>
                                            <td>{{ f.lastError ?? '-' }}</td>
                                            <td>{{ formatDate(f.updatedAt) }}</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                                <!-- スマホ・タブレット向け: 表の代わりにカード一覧で表示する -->
                                <div v-else>
                                    <v-card v-for="f in notificationFailures" :key="f.id" variant="outlined" class="mb-2 pa-2">
                                        <div class="d-flex align-center flex-wrap ga-2">
                                            <span class="text-body-2 font-weight-bold">{{ f.targetName }}</span>
                                            <v-chip size="x-small">{{ f.eventType }}</v-chip>
                                            <span class="text-caption">試行 {{ f.attempts }} 回</span>
                                        </div>
                                        <div class="text-caption text-error mt-1">{{ f.lastError ?? '-' }}</div>
                                        <div class="text-caption text-medium-emphasis">{{ formatDate(f.updatedAt) }}</div>
                                    </v-card>
                                </div>
                            </template>
                        </v-window-item>

                        <!-- シリーズ管理タブ -->
                        <v-window-item value="series">
                            <v-slider v-model="settings.series.matchThreshold" :min="0" :max="1" :step="0.05" label="自動マッチしきい値"></v-slider>

                            <template v-if="isEnabledSeriesLibrary === true">
                                <v-divider class="my-4"></v-divider>
                                <div class="text-subtitle-1 mb-2">精度メトリクス (§4.10)</div>
                                <v-btn size="small" variant="text" @click="loadMetrics">再読み込み</v-btn>
                                <div v-if="metrics !== null" class="mt-2">
                                    <div>対象番組数: {{ metrics.totalPrograms }} / マッチ済み: {{ metrics.matchedPrograms }}</div>
                                    <div>未マッチ番組率: {{ (metrics.unmatchedRate * 100).toFixed(1) }}%</div>
                                    <div class="mt-2">confidence 分布 (0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0)</div>
                                    <div class="d-flex ga-2">
                                        <v-chip v-for="(c, i) in metrics.confidenceHistogram" :key="i" size="small">{{ c }}</v-chip>
                                    </div>
                                    <div v-if="metrics.updatedAt !== null" class="text-caption mt-1">最終更新: {{ formatDate(metrics.updatedAt) }}</div>
                                </div>
                                <v-alert v-else type="info" class="mt-2">メトリクスは未取得です</v-alert>

                                <v-divider class="my-4"></v-divider>
                                <div class="text-subtitle-1 mb-2">既存録画の一括シリーズ化 (バックフィル)</div>
                                <div v-if="backfillStatus" class="mb-2">
                                    <div>状態: {{ backfillStateText }}</div>
                                    <v-progress-linear v-if="backfillStatus.state === 'running'" :model-value="backfillProgressPercent" height="20" color="primary" striped>
                                        <template #default>{{ backfillStatus.processed }} / {{ backfillStatus.total }}</template>
                                    </v-progress-linear>
                                    <div v-if="backfillStatus.state !== 'idle'" class="mt-1">
                                        確定: {{ backfillStatus.linked }} / 未確定: {{ backfillStatus.pending }} / スキップ: {{ backfillStatus.skipped }} / 失敗:
                                        {{ backfillStatus.failed }}
                                    </div>
                                    <v-alert v-if="backfillStatus.error" type="error" class="mt-2">{{ backfillStatus.error }}</v-alert>
                                </div>
                                <div class="d-flex flex-wrap align-center ga-4 mb-2">
                                    <v-checkbox
                                        v-model="backfillOnlyUnlinked"
                                        label="まだシリーズ化されていない録画だけを対象にする"
                                        density="compact"
                                        hide-details
                                    ></v-checkbox>
                                    <v-text-field
                                        v-model="backfillLatest"
                                        label="直近の件数だけ実行 (空欄で全件)"
                                        type="number"
                                        min="1"
                                        density="compact"
                                        hide-details
                                        style="max-width: 260px"
                                    ></v-text-field>
                                </div>
                                <div class="text-caption mb-2">
                                    直近の件数を指定した実行は一時的な部分実行として扱い、全件バックフィルの再開位置には影響しない
                                </div>
                                <div class="d-flex flex-wrap ga-2 mb-3">
                                    <v-btn variant="outlined" :loading="backfillStarting" :disabled="backfillStatus?.state === 'running'" @click="startBackfill(true)">
                                        ドライラン実行
                                    </v-btn>
                                    <v-btn
                                        color="primary"
                                        variant="outlined"
                                        :loading="backfillStarting"
                                        :disabled="backfillStatus?.state === 'running'"
                                        @click="startBackfill(false)"
                                    >
                                        本実行 (確定適用)
                                    </v-btn>
                                    <v-btn color="error" variant="outlined" :disabled="backfillStatus?.state !== 'running'" @click="cancelBackfill">キャンセル</v-btn>
                                </div>

                                <v-card v-if="backfillStatus?.previewItems && backfillStatus.previewItems.length > 0" variant="outlined" class="mb-4">
                                    <v-card-title class="text-subtitle-1">
                                        ドライラン結果プレビュー
                                        <span v-if="backfillStatus.previewTruncated === true">(一部のみ表示)</span>
                                    </v-card-title>
                                    <v-table density="compact">
                                        <thead>
                                            <tr>
                                                <th>録画</th>
                                                <th>判定</th>
                                                <th>候補</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="p in backfillStatus.previewItems" :key="p.recordedId">
                                                <td>{{ p.title }}</td>
                                                <td>
                                                    <v-chip v-if="p.matched === true" :color="p.seriesId === null ? 'info' : 'success'" size="small">
                                                        {{ p.seriesId === null ? '新規: ' : '' }}{{ p.seriesTitle }} ({{ Math.round((p.confidence ?? 0) * 100) }}%)
                                                    </v-chip>
                                                    <v-chip v-else color="warning" size="small">未確定</v-chip>
                                                </td>
                                                <td>{{ p.candidates.map(c => c.seriesTitle).join('、') }}</td>
                                            </tr>
                                        </tbody>
                                    </v-table>
                                </v-card>

                                <v-divider class="my-4"></v-divider>
                                <div class="text-subtitle-1 mb-2">エイリアス辞書 (マッチングルール)</div>
                                <div class="text-caption mb-2">
                                    「正規化タイトル → シリーズ」の対応表。手動修正のほか、LLM が抽出した番組名を検証できたものを自動学習する。 ここに載っている表記は以後 LLM
                                    を引かずに確定する
                                </div>
                                <div class="d-flex align-center ga-2 flex-wrap mb-2">
                                    <v-btn-toggle v-model="aliasSourceFilter" density="compact" mandatory>
                                        <v-btn value="all" size="small">すべて ({{ aliases.length }})</v-btn>
                                        <v-btn value="llm" size="small">LLM 学習 ({{ llmAliasCount }})</v-btn>
                                        <v-btn value="manual" size="small">手動 ({{ aliases.length - llmAliasCount }})</v-btn>
                                    </v-btn-toggle>
                                    <v-text-field
                                        v-model="aliasKeyword"
                                        label="正規化タイトル / シリーズで絞り込み"
                                        density="compact"
                                        hide-details
                                        clearable
                                        prepend-inner-icon="mdi-magnify"
                                        style="max-width: 280px"
                                    ></v-text-field>
                                </div>

                                <!-- 誤学習の一括修正バー。選択した行をまとめて同じシリーズへ付け替える / 削除する -->
                                <v-card v-if="selectedAliasIds.length > 0" variant="tonal" class="mb-2">
                                    <v-card-text class="py-2">
                                        <div class="d-flex align-center ga-2 flex-wrap">
                                            <span class="text-body-2">{{ selectedAliasIds.length }} 件選択中</span>
                                            <v-autocomplete
                                                v-model="bulkAliasSeriesId"
                                                v-model:search="bulkAliasKeyword"
                                                :items="seriesCandidateItems"
                                                item-title="title"
                                                item-value="value"
                                                label="まとめて付け替える先"
                                                density="compact"
                                                hide-details
                                                hide-no-data
                                                :loading="seriesSearching"
                                                style="min-width: 260px"
                                            ></v-autocomplete>
                                            <v-btn size="small" variant="flat" color="primary" :disabled="bulkAliasSeriesId === null" @click="applyBulkAliasSeries">
                                                選択に適用
                                            </v-btn>
                                            <v-btn size="small" variant="text" color="error" @click="markAliasRemove">選択を削除対象にする</v-btn>
                                            <v-btn size="small" variant="text" @click="selectedAliasIds = []">選択解除</v-btn>
                                        </div>
                                    </v-card-text>
                                </v-card>

                                <v-table density="compact" class="alias-table">
                                    <!-- 列幅はビューポートに対する割合 (%) で指定し、正規化タイトルとシリーズを同程度の幅に保つ -->
                                    <colgroup>
                                        <col class="alias-col-check" />
                                        <col class="alias-col-normalized" />
                                        <col class="alias-col-series" />
                                        <col v-if="isMobile === false" class="alias-col-source" />
                                        <col v-if="isMobile === false" class="alias-col-date" />
                                        <col class="alias-col-action" />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th>
                                                <v-checkbox-btn :model-value="isAllAliasSelected" @update:model-value="toggleAllAlias"></v-checkbox-btn>
                                            </th>
                                            <th>正規化タイトル</th>
                                            <th>シリーズ</th>
                                            <th v-if="isMobile === false">学習元</th>
                                            <th v-if="isMobile === false" class="alias-date-cell">登録日時</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="a in filteredAliases" :key="a.id" :class="{ 'alias-removed': aliasEdits[a.id]?.remove === true }">
                                            <td>
                                                <v-checkbox-btn v-model="selectedAliasIds" :value="a.id"></v-checkbox-btn>
                                            </td>
                                            <td class="alias-normalized-cell">{{ a.normalizedTitle }}</td>
                                            <td>
                                                <span v-if="aliasEdits[a.id]?.remove === true" class="text-error text-body-2">削除します</span>
                                                <v-autocomplete
                                                    v-else
                                                    :model-value="aliasEdits[a.id]?.seriesId ?? a.seriesId"
                                                    :items="aliasSeriesItems(a)"
                                                    item-title="title"
                                                    item-value="value"
                                                    v-model:search="aliasSearchKeyword"
                                                    density="compact"
                                                    variant="outlined"
                                                    hide-details
                                                    hide-no-data
                                                    :loading="seriesSearching"
                                                    @update:model-value="value => setAliasSeries(a, value)"
                                                ></v-autocomplete>
                                            </td>
                                            <td v-if="isMobile === false">
                                                <v-chip size="x-small" :color="aliasSourceOf(a) === 'llm' ? 'primary' : undefined">
                                                    {{ aliasSourceOf(a) === 'llm' ? 'LLM 学習' : '手動' }}
                                                </v-chip>
                                            </td>
                                            <td v-if="isMobile === false" class="text-caption alias-date-cell">{{ formatDate(a.createdAt) }}</td>
                                            <td>
                                                <v-btn v-if="isAliasEdited(a.id)" size="small" variant="text" @click="resetAliasEdit(a.id)">戻す</v-btn>
                                                <v-btn v-else size="small" variant="text" color="error" @click="markAliasRemove(a.id)">削除</v-btn>
                                            </td>
                                        </tr>
                                    </tbody>
                                </v-table>
                                <v-alert v-if="filteredAliases.length === 0" type="info" class="mt-2">エイリアスはありません</v-alert>
                                <div class="d-flex align-center ga-2 mt-3">
                                    <v-btn color="primary" :loading="aliasSaving" :disabled="changedAliasItems.length === 0" @click="saveAliases">
                                        辞書の変更を保存 ({{ changedAliasItems.length }} 件)
                                    </v-btn>
                                    <v-btn variant="text" :disabled="changedAliasItems.length === 0" @click="aliasEdits = {}">変更を破棄</v-btn>
                                    <span class="text-caption text-grey">保存した辞書は手動修正扱いになり、以後の自動学習で上書きされません</span>
                                </div>

                                <v-divider class="my-4"></v-divider>
                                <div class="text-subtitle-1 mb-2">作品辞書から探して登録</div>
                                <div class="text-caption mb-2">
                                    付け替え先のシリーズがまだ無いときは、同期済みのマスタ (しょぼいカレンダー / Annict / Wikidata) を直接検索してシリーズを作れる。
                                    作成したシリーズには辞書の外部 ID・読み仮名・クール・総話数がそのまま入る
                                </div>
                                <div class="d-flex align-center ga-2 flex-wrap mb-2">
                                    <v-text-field
                                        v-model="dictionaryKeyword"
                                        label="作品名で辞書を検索"
                                        density="compact"
                                        hide-details
                                        clearable
                                        style="max-width: 360px"
                                        @keyup.enter="searchDictionary"
                                    ></v-text-field>
                                    <v-btn
                                        color="primary"
                                        size="small"
                                        :loading="dictionarySearching"
                                        :disabled="(dictionaryKeyword || '').trim().length < 2"
                                        @click="searchDictionary"
                                    >
                                        検索
                                    </v-btn>
                                </div>
                                <v-table v-if="dictionaryWorks.length > 0" density="compact">
                                    <thead>
                                        <tr>
                                            <th>作品</th>
                                            <th>辞書</th>
                                            <th v-if="isMobile === false">クール</th>
                                            <th v-if="isMobile === false">話数</th>
                                            <th v-if="isMobile === false">外部 ID</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="w in dictionaryWorks" :key="dictionaryWorkKey(w)">
                                            <td>
                                                <div>{{ w.title }}</div>
                                                <div v-if="w.titleKana" class="text-caption text-grey">{{ w.titleKana }}</div>
                                                <div v-if="isMobile === true" class="text-caption text-medium-emphasis">
                                                    {{ dictionarySeasonLabel(w) }} / 話数: {{ w.totalEpisodes || '-' }} / {{ dictionaryIdsLabel(w) }}
                                                </div>
                                            </td>
                                            <td>{{ dictionarySourceLabel(w.source) }}</td>
                                            <td v-if="isMobile === false">{{ dictionarySeasonLabel(w) }}</td>
                                            <td v-if="isMobile === false">{{ w.totalEpisodes || '-' }}</td>
                                            <td v-if="isMobile === false" class="text-caption">{{ dictionaryIdsLabel(w) }}</td>
                                            <td class="text-right">
                                                <v-chip v-if="w.seriesId" size="small" color="success" variant="tonal">登録済み</v-chip>
                                                <v-btn
                                                    v-else
                                                    size="small"
                                                    variant="outlined"
                                                    :loading="dictionaryCreatingKey === dictionaryWorkKey(w)"
                                                    @click="createSeriesFromDictionary(w)"
                                                >
                                                    シリーズを作成
                                                </v-btn>
                                            </td>
                                        </tr>
                                    </tbody>
                                </v-table>
                                <v-alert v-else-if="dictionarySearched" type="info" class="mt-2">辞書に一致する作品がありません</v-alert>

                                <v-divider class="my-4"></v-divider>
                                <div class="text-subtitle-1 mb-2">録画 0 件のシリーズの掃除</div>
                                <div class="text-caption mb-2">
                                    マージ・分割・録画削除の結果、録画が 1 件も紐づいていないシリーズ (自動生成の抜け殻) が残ることがある。
                                    削除すると、そのシリーズを指しているエイリアス辞書・エピソード・予約ヒントも一緒に消える (録画ファイルは削除されない)
                                </div>
                                <div class="d-flex align-center ga-2 flex-wrap mb-2">
                                    <v-btn size="small" variant="text" :loading="emptySeriesLoading" @click="loadEmptySeries">再読み込み</v-btn>
                                    <v-btn
                                        size="small"
                                        color="error"
                                        variant="outlined"
                                        :loading="emptySeriesDeleting"
                                        :disabled="selectedEmptySeriesIds.length === 0"
                                        @click="deleteEmptySeries(false)"
                                    >
                                        選択した {{ selectedEmptySeriesIds.length }} 件を削除
                                    </v-btn>
                                    <v-btn
                                        size="small"
                                        color="error"
                                        variant="text"
                                        :loading="emptySeriesDeleting"
                                        :disabled="emptySeries.length === 0"
                                        @click="deleteEmptySeries(true)"
                                    >
                                        すべて削除 ({{ emptySeries.length }} 件)
                                    </v-btn>
                                </div>
                                <v-table v-if="emptySeries.length > 0" density="compact">
                                    <thead>
                                        <tr>
                                            <th style="width: 48px">
                                                <v-checkbox-btn
                                                    :model-value="isAllEmptySeriesSelected"
                                                    :indeterminate="selectedEmptySeriesIds.length > 0 && isAllEmptySeriesSelected === false"
                                                    @update:model-value="toggleAllEmptySeries"
                                                ></v-checkbox-btn>
                                            </th>
                                            <th>シリーズ</th>
                                            <th style="width: 110px">出所</th>
                                            <th style="width: 90px">辞書</th>
                                            <th style="width: 90px">話数</th>
                                            <th style="width: 150px">作成日時</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="s in emptySeries" :key="s.seriesId">
                                            <td><v-checkbox-btn v-model="selectedEmptySeriesIds" :value="s.seriesId"></v-checkbox-btn></td>
                                            <td>
                                                {{ s.title }}
                                                <div class="text-caption text-grey">{{ s.normalizedTitle }}</div>
                                            </td>
                                            <td>
                                                <v-chip size="x-small" :color="s.origin === 'dictionary' ? 'primary' : undefined">
                                                    {{ s.origin === 'dictionary' ? '辞書' : '自動生成' }}
                                                </v-chip>
                                            </td>
                                            <td>{{ s.aliasCount }}</td>
                                            <td>{{ s.episodeCount }}</td>
                                            <td class="text-caption">{{ formatDate(s.createdAt) }}</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                                <v-alert v-else type="info" class="mt-2">録画 0 件のシリーズはありません</v-alert>
                            </template>
                            <v-alert v-else type="info" class="mt-4">
                                シリーズライブラリ機能 (featureFlags.seriesLibrary) が無効なため、バックフィルとエイリアス管理は利用できません
                            </v-alert>
                        </v-window-item>

                        <!-- 設定ファイルタブ: config.yml をフォームから編集する -->
                        <v-window-item value="config">
                            <ConfigFormPanel></ConfigFormPanel>
                        </v-window-item>

                        <!-- 更新タブ: リリース版 / main ブランチの最新へのワンクリック更新 -->
                        <v-window-item value="update">
                            <UpdatePanel></UpdatePanel>
                        </v-window-item>

                        <!-- アカウントタブ: ログインユーザーの管理 (config.yml の auth.enabled が有効なときのみ) -->
                        <v-window-item value="account">
                            <div class="text-subtitle-1 mb-2">ログインユーザー</div>
                            <div class="text-caption mb-2">
                                システム管理者は設定変更・ユーザー管理・バージョン更新ができます。最初にサインアップした人が自動でシステム管理者になり、以降は一般権限です。
                                パスワードを変更すると、そのユーザーのログイン状態 (発行済みセッション) はすべて無効になります
                            </div>
                            <v-table v-if="isMobile === false" density="compact">
                                <thead>
                                    <tr>
                                        <th>ユーザー名</th>
                                        <th style="width: 130px">権限</th>
                                        <th style="width: 150px">作成日時</th>
                                        <th style="width: 260px"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="u in authUsers" :key="u.id">
                                        <td>
                                            {{ u.name }}
                                            <v-chip v-if="u.name === currentUserName" size="x-small" color="primary" class="ml-1">ログイン中</v-chip>
                                            <div class="d-flex ga-1 mt-1">
                                                <v-chip v-for="p in u.providers" :key="p" size="x-small" variant="outlined">{{ p }}</v-chip>
                                                <v-chip v-if="u.hasPassword === true" size="x-small" variant="outlined">パスワード</v-chip>
                                            </div>
                                        </td>
                                        <td>
                                            <v-chip size="x-small" :color="u.role === 'admin' ? 'deep-purple' : undefined" variant="flat">
                                                {{ u.role === 'admin' ? 'システム管理者' : '一般' }}
                                            </v-chip>
                                        </td>
                                        <td class="text-caption">{{ formatDate(u.createdAt) }}</td>
                                        <td>
                                            <v-btn size="small" variant="text" @click="toggleRole(u)">
                                                {{ u.role === 'admin' ? '一般にする' : '管理者にする' }}
                                            </v-btn>
                                            <v-btn v-if="u.hasPassword === true || u.name === currentUserName" size="small" variant="text" @click="openPasswordDialog(u)">
                                                パスワード
                                            </v-btn>
                                            <v-btn size="small" variant="text" color="error" :disabled="authUsers.length <= 1" @click="removeAuthUser(u)">削除</v-btn>
                                        </td>
                                    </tr>
                                </tbody>
                            </v-table>
                            <!-- スマホ・タブレット向け: 表の代わりにカード一覧で表示する -->
                            <div v-else>
                                <v-card v-for="u in authUsers" :key="u.id" variant="outlined" class="mb-2 pa-2">
                                    <div class="d-flex align-center flex-wrap ga-1 mb-1">
                                        <span class="text-body-1">{{ u.name }}</span>
                                        <v-chip v-if="u.name === currentUserName" size="x-small" color="primary">ログイン中</v-chip>
                                        <v-chip size="x-small" :color="u.role === 'admin' ? 'deep-purple' : undefined" variant="flat">
                                            {{ u.role === 'admin' ? 'システム管理者' : '一般' }}
                                        </v-chip>
                                    </div>
                                    <div class="d-flex ga-1 flex-wrap mb-1">
                                        <v-chip v-for="p in u.providers" :key="p" size="x-small" variant="outlined">{{ p }}</v-chip>
                                        <v-chip v-if="u.hasPassword === true" size="x-small" variant="outlined">パスワード</v-chip>
                                    </div>
                                    <div class="text-caption text-medium-emphasis mb-2">作成日時: {{ formatDate(u.createdAt) }}</div>
                                    <div class="d-flex flex-wrap ga-1">
                                        <v-btn size="small" variant="text" @click="toggleRole(u)">
                                            {{ u.role === 'admin' ? '一般にする' : '管理者にする' }}
                                        </v-btn>
                                        <v-btn v-if="u.hasPassword === true || u.name === currentUserName" size="small" variant="text" @click="openPasswordDialog(u)">
                                            パスワード
                                        </v-btn>
                                        <v-btn size="small" variant="text" color="error" :disabled="authUsers.length <= 1" @click="removeAuthUser(u)">削除</v-btn>
                                    </div>
                                </v-card>
                            </div>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">ユーザーの追加</div>
                            <div class="d-flex ga-2 flex-wrap align-start">
                                <v-text-field v-model="newUserName" label="ユーザー名" density="compact" hide-details style="max-width: 220px"></v-text-field>
                                <v-text-field
                                    v-model="newUserPassword"
                                    label="パスワード (8 文字以上)"
                                    type="password"
                                    autocomplete="new-password"
                                    density="compact"
                                    hide-details
                                    style="max-width: 240px"
                                ></v-text-field>
                                <v-btn color="primary" :loading="authSaving" :disabled="newUserName.trim() === '' || newUserPassword === ''" @click="addAuthUser">追加</v-btn>
                            </div>
                        </v-window-item>
                    </v-window>
                    <v-btn v-if="tab !== 'update' && tab !== 'account' && tab !== 'config'" color="primary" :loading="saving" @click="save">保存</v-btn>
                </v-card-text>
            </v-card>
        </v-container>

        <v-dialog v-model="isOpenPasswordDialog" max-width="460">
            <v-card>
                <v-card-title>パスワードの変更</v-card-title>
                <v-card-subtitle>{{ passwordTargetName }}</v-card-subtitle>
                <v-card-text>
                    <v-text-field
                        v-if="passwordTargetName === currentUserName"
                        v-model="currentPassword"
                        label="現在のパスワード"
                        type="password"
                        autocomplete="current-password"
                        density="compact"
                    ></v-text-field>
                    <v-text-field v-model="newPassword" label="新しいパスワード (8 文字以上)" type="password" autocomplete="new-password" density="compact"></v-text-field>
                    <v-text-field v-model="newPasswordConfirm" label="新しいパスワード (確認)" type="password" autocomplete="new-password" density="compact"></v-text-field>
                    <v-alert v-if="newPassword !== '' && newPassword !== newPasswordConfirm" type="error" density="compact">確認用のパスワードが一致しません</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenPasswordDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="authSaving" :disabled="newPassword === '' || newPassword !== newPasswordConfirm" @click="saveNewPassword">
                        変更する
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import UpdatePanel from '@/components/update/UpdatePanel.vue';
import ConfigFormPanel from '@/components/settings/ConfigFormPanel.vue';
import IAuthApiModel, { AuthUserItem } from '@/model/api/auth/IAuthApiModel';
import container from '@/model/ModelContainer';
import IChannelsApiModel from '@/model/api/channels/IChannelsApiModel';
import ISystemSettingApiModel from '@/model/api/config/ISystemSettingApiModel';
import ISeriesApiModel, {
    DictionaryWorkItem,
    EmptySeriesItem,
    SeriesAliasItem,
    SeriesBackfillResult,
    SeriesListItem,
    ProgramSeriesMetrics,
} from '@/model/api/series/ISeriesApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

/**
 * エイリアス辞書の編集内容 (保存するまでサーバへは送らない)
 */
interface AliasEdit {
    seriesId?: number;
    seriesTitle?: string;
    remove?: boolean;
}

interface NotificationTargetForm {
    __key: string;
    __renamed?: boolean;
    name: string;
    type: string;
    url: string;
    secret: string;
    events: string[];
}

interface ChannelMapEntryForm {
    __key: string;
    // マッピング先チャンネルを選択したときに networkId/serviceId を補完するためだけに使う (保存対象外)
    __channelId: number | null;
    chId: number | null;
    networkId: number | null;
    serviceId: number | null;
    syobocal: boolean;
}

@Component({ components: { TitleBar, UpdatePanel, ConfigFormPanel } })
class SystemSetting extends Vue {
    // 一括解析ジョブの進捗ポーリング間隔
    private static readonly ANALYZE_JOB_POLLING_INTERVAL = 2000;

    // スマホ・タブレット向け: 表の列を間引いたりカード一覧に切り替えるための判定
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    tab = 'basic';
    saving = false;
    testingTargetName: string | null = null;

    private api = container.get<ISystemSettingApiModel>('ISystemSettingApiModel');
    private seriesApi = container.get<ISeriesApiModel>('ISeriesApiModel');
    private channelsApi = container.get<IChannelsApiModel>('IChannelsApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private videoApi = container.get<IVideoApiModel>('IVideoApiModel');

    // --- 録画ファイルのメタデータ取得 ---
    videoMetadataStatus: apid.VideoFileMetadataStatus = { total: 0, analyzed: 0, unanalyzed: 0 };
    videoMetadataLoading = false;

    // --- 録画ファイルの TS (PSI/SI) 解析 ---
    tsInfoStatus: apid.VideoFileMetadataStatus = { total: 0, analyzed: 0, unanalyzed: 0 };
    tsInfoLoading = false;

    // --- 一括解析ジョブ (サーバー側で進むため、画面を閉じても継続する) ---
    analyzeJob: apid.VideoAnalyzeJob | null = null;
    private analyzeJobTimer: number | null = null;

    /**
     * 指定した種別のジョブなら返す (メタデータ欄と TS 欄で進捗の出し分けに使う)
     */
    analyzeJobOf(type: apid.VideoAnalyzeJobType): apid.VideoAnalyzeJob | null {
        return this.analyzeJob !== null && this.analyzeJob.type === type && this.analyzeJob.status !== 'idle' ? this.analyzeJob : null;
    }

    get isAnalyzeJobRunning(): boolean {
        return this.analyzeJob?.status === 'running';
    }

    get analyzeJobPercent(): number {
        if (this.analyzeJob === null || this.analyzeJob.total === 0) return 0;

        return Math.min(100, Math.round((this.analyzeJob.processed / this.analyzeJob.total) * 100));
    }

    get analyzeJobText(): string {
        const job = this.analyzeJob;
        if (job === null) return '';

        const counts = `${job.processed} / ${job.total} 件 (成功 ${job.analyzed} / 失敗 ${job.failed})`;
        switch (job.status) {
            case 'running':
                return `解析中... ${counts}`;
            case 'succeeded':
                return `解析完了: ${counts}`;
            case 'canceled':
                return `中断しました: ${counts}`;
            case 'failed':
                return `解析ジョブが中断しました (${job.error ?? 'unknown error'}): ${counts}`;
            default:
                return counts;
        }
    }

    requiresRestartKeys: string[] = [];

    readonly notificationEventItems: string[] = ['recording.started', 'recording.completed', 'recording.failed', 'reserve.added', 'reserve.updated', 'reserve.deleted'];

    /**
     * シリーズライブラリ機能が有効か (featureFlags.seriesLibrary)。無効な場合はバックフィル/エイリアス管理 UI を隠す
     */
    get isEnabledSeriesLibrary(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    // --- アカウント (ログインユーザー管理) ---
    authUsers: AuthUserItem[] = [];
    currentUserName = '';
    isAuthEnabled = false;
    // 認証が無効な場合は全員が管理者相当 (従来どおりの動作)
    isAdmin = true;
    newUserName = '';
    newUserPassword = '';
    authSaving = false;
    isOpenPasswordDialog = false;
    passwordTargetId: number | null = null;
    passwordTargetName = '';
    currentPassword = '';
    newPassword = '';
    newPasswordConfirm = '';

    private authApi = container.get<IAuthApiModel>('IAuthApiModel');

    /**
     * ログインユーザー一覧を読み込む (認証が無効なら何もしない)
     */
    async loadAuth(): Promise<void> {
        try {
            const status = await this.authApi.getStatus();
            this.isAuthEnabled = status.enabled;
            this.currentUserName = status.user?.name ?? '';
            this.isAdmin = status.enabled === false || status.user?.role === 'admin';
            if (status.enabled === false) return;
            this.authUsers = await this.authApi.listUsers();
        } catch (err) {
            console.error(err);
        }
    }

    async addAuthUser(): Promise<void> {
        this.authSaving = true;
        try {
            await this.authApi.addUser(this.newUserName.trim(), this.newUserPassword);
            this.newUserName = '';
            this.newUserPassword = '';
            this.snackbarState.open({ color: 'success', text: 'ユーザーを追加しました' });
            await this.loadAuth();
        } catch (err: any) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: SystemSetting.authErrorText(err) });
        } finally {
            this.authSaving = false;
        }
    }

    /**
     * システム管理者権限の付与 / 剥奪
     */
    async toggleRole(user: AuthUserItem): Promise<void> {
        const role = user.role === 'admin' ? 'user' : 'admin';
        try {
            await this.authApi.setRole(user.id, role);
            this.snackbarState.open({
                color: 'success',
                text: role === 'admin' ? `${user.name} をシステム管理者にしました` : `${user.name} を一般権限にしました`,
            });
            await this.loadAuth();
        } catch (err: any) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: SystemSetting.authErrorText(err) });
        }
    }

    async removeAuthUser(user: AuthUserItem): Promise<void> {
        try {
            await this.authApi.removeUser(user.id);
            this.snackbarState.open({ color: 'success', text: `${user.name} を削除しました` });
            await this.loadAuth();
        } catch (err: any) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: SystemSetting.authErrorText(err) });
        }
    }

    openPasswordDialog(user: AuthUserItem): void {
        this.passwordTargetId = user.id;
        this.passwordTargetName = user.name;
        this.currentPassword = '';
        this.newPassword = '';
        this.newPasswordConfirm = '';
        this.isOpenPasswordDialog = true;
    }

    async saveNewPassword(): Promise<void> {
        if (this.passwordTargetId === null) return;
        this.authSaving = true;
        try {
            // 自分のパスワードを変えるときだけ現在のパスワードを送る
            const current = this.passwordTargetName === this.currentUserName ? this.currentPassword : undefined;
            await this.authApi.changePassword(this.passwordTargetId, this.newPassword, current);
            this.isOpenPasswordDialog = false;
            if (this.passwordTargetName === this.currentUserName) {
                // 自分のセッションも無効になるのでログインし直してもらう
                this.snackbarState.open({ color: 'success', text: 'パスワードを変更しました。再ログインしてください' });
                window.setTimeout(() => window.location.replace(window.location.pathname), 1500);
            } else {
                this.snackbarState.open({ color: 'success', text: 'パスワードを変更しました' });
            }
        } catch (err: any) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: SystemSetting.authErrorText(err) });
        } finally {
            this.authSaving = false;
        }
    }

    private static authErrorText(err: any): string {
        switch (err?.response?.data?.message ?? '') {
            case 'InvalidCredentials':
                return '現在のパスワードが違います';
            case 'PasswordIsTooShort':
                return 'パスワードは 8 文字以上にしてください';
            case 'PasswordIsTooLong':
                return 'パスワードが長すぎます';
            case 'InvalidUserName':
                return 'ユーザー名を入力してください';
            case 'UserNameIsAlreadyUsed':
                return 'そのユーザー名はすでに使われています';
            case 'LastUserCanNotBeRemoved':
                return '最後の 1 人は削除できません';
            case 'LastAdminCanNotBeDemoted':
                return '最後のシステム管理者は一般権限にできません';
            case 'LastAdminCanNotBeRemoved':
                return '最後のシステム管理者は削除できません';
            default:
                return '操作に失敗しました';
        }
    }

    /**
     * 更新通知・ワンクリック更新が有効か (featureFlags.updateNotification)
     */
    get isUpdateEnabled(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'updateNotification');
    }

    /**
     * Annict 視聴記録同期の二重ゲートのうち、サーバー設定 (featureFlags) 側の状態。
     * config.yml 側で無効な場合、この画面のスイッチを ON にしても同期は動作しない
     */
    get isEnabledAnnictSyncFeature(): boolean {
        const config = this.serverConfigModel.getConfig();
        return isFeatureEnabled(config, 'metadataProviders') === true && isFeatureEnabled(config, 'annictSync') === true;
    }

    backfillStatus: SeriesBackfillResult | null = null;
    backfillStarting = false;
    // バックフィルの対象絞り込み
    backfillOnlyUnlinked = false;
    backfillLatest: string = '';
    private backfillPollTimer: ReturnType<typeof setInterval> | null = null;
    private seriesSearchTimer: ReturnType<typeof setTimeout> | null = null;
    // --- 録画 0 件のシリーズの掃除 ---
    emptySeries: EmptySeriesItem[] = [];
    selectedEmptySeriesIds: number[] = [];
    emptySeriesLoading = false;
    emptySeriesDeleting = false;
    dictionaryKeyword = '';
    dictionaryWorks: DictionaryWorkItem[] = [];
    dictionarySearching = false;
    dictionarySearched = false;
    // 作成ボタンを行単位で loading にするためのキー
    dictionaryCreatingKey: string | null = null;

    aliases: SeriesAliasItem[] = [];
    aliasSourceFilter: 'all' | 'llm' | 'manual' = 'all';
    aliasKeyword = '';
    // 保存前の編集内容 (aliasId → 付け替え先 / 削除フラグ)
    aliasEdits: Record<number, AliasEdit> = {};
    selectedAliasIds: number[] = [];
    aliasSaving = false;
    // 付け替え先を選ぶオートコンプリートの候補
    seriesCandidates: SeriesListItem[] = [];
    seriesSearching = false;
    aliasSearchKeyword = '';
    bulkAliasKeyword = '';
    bulkAliasSeriesId: number | null = null;

    get llmAliasCount(): number {
        return this.aliases.filter(a => a.source === 'llm').length;
    }

    // 自動学習した対応だけを見たいことがあるので学習元とキーワードで絞り込めるようにする
    get filteredAliases(): SeriesAliasItem[] {
        const keyword = (this.aliasKeyword ?? '').trim();
        return this.aliases.filter(a => {
            if (this.aliasSourceFilter !== 'all') {
                const isLlm = this.aliasSourceFilter === 'llm';
                if (isLlm ? a.source !== 'llm' : a.source === 'llm') return false;
            }
            if (keyword === '') return true;
            return a.normalizedTitle.includes(keyword) || a.seriesTitle.includes(keyword);
        });
    }

    /**
     * 編集後の学習元。付け替えたものは保存すると手動修正扱いになるので、その場で表示も切り替える
     */
    aliasSourceOf(alias: SeriesAliasItem): string {
        return this.isAliasEdited(alias.id) ? 'manual' : alias.source;
    }
    isAliasEdited(aliasId: number): boolean {
        return typeof this.aliasEdits[aliasId] !== 'undefined';
    }
    get isAllAliasSelected(): boolean {
        return this.filteredAliases.length > 0 && this.selectedAliasIds.length === this.filteredAliases.length;
    }
    toggleAllAlias(value: boolean | null): void {
        this.selectedAliasIds = value === true ? this.filteredAliases.map(a => a.id) : [];
    }

    /**
     * 行ごとのオートコンプリート候補。検索結果に加えて現在の付け替え先も必ず含める
     * (候補に無いと選択中の値が表示されないため)
     */
    aliasSeriesItems(alias: SeriesAliasItem): Array<{ title: string; value: number }> {
        const edit = this.aliasEdits[alias.id];
        const current = {
            title: edit?.seriesTitle ?? alias.seriesTitle,
            value: edit?.seriesId ?? alias.seriesId,
        };
        const items = this.seriesCandidateItems.filter(x => x.value !== current.value);
        return [current, ...items];
    }
    get seriesCandidateItems(): Array<{ title: string; value: number }> {
        return this.seriesCandidates.map(x => ({ title: x.title, value: x.id }));
    }

    /**
     * 1 行分の付け替え先を編集バッファに記録する (元の値へ戻したら編集を取り消す)
     */
    setAliasSeries(alias: SeriesAliasItem, seriesId: number | null): void {
        if (seriesId === null || seriesId === alias.seriesId) {
            this.resetAliasEdit(alias.id);
            return;
        }
        const title = this.seriesCandidates.find(x => x.id === seriesId)?.title ?? '';
        this.aliasEdits = { ...this.aliasEdits, [alias.id]: { seriesId, seriesTitle: title } };
    }
    /**
     * 選択した行をまとめて同じシリーズへ付け替える
     */
    applyBulkAliasSeries(): void {
        if (this.bulkAliasSeriesId === null) return;
        const seriesId = this.bulkAliasSeriesId;
        const title = this.seriesCandidates.find(x => x.id === seriesId)?.title ?? '';
        const edits = { ...this.aliasEdits };
        for (const id of this.selectedAliasIds) {
            const alias = this.aliases.find(a => a.id === id);
            if (typeof alias === 'undefined') continue;
            if (alias.seriesId === seriesId) delete edits[id];
            else edits[id] = { seriesId, seriesTitle: title };
        }
        this.aliasEdits = edits;
        this.selectedAliasIds = [];
        this.bulkAliasSeriesId = null;
    }
    /**
     * 削除対象としてマークする (実際の削除は保存時)
     */
    markAliasRemove(aliasId?: number): void {
        const targets = typeof aliasId === 'number' ? [aliasId] : this.selectedAliasIds;
        const edits = { ...this.aliasEdits };
        for (const id of targets) edits[id] = { remove: true };
        this.aliasEdits = edits;
        if (typeof aliasId !== 'number') this.selectedAliasIds = [];
    }
    resetAliasEdit(aliasId: number): void {
        const edits = { ...this.aliasEdits };
        delete edits[aliasId];
        this.aliasEdits = edits;
    }
    get changedAliasItems(): apid.BulkSeriesAliasItem[] {
        return Object.entries(this.aliasEdits).map(([aliasId, edit]) =>
            edit.remove === true ? { aliasId: Number(aliasId), remove: true } : { aliasId: Number(aliasId), seriesId: edit.seriesId },
        );
    }
    metrics: ProgramSeriesMetrics | null = null;

    historyKey = 'notifications';
    readonly historyKeyItems = [
        { title: '通知 (notifications)', value: 'notifications' },
        { title: '連携 (metadata)', value: 'metadata' },
        { title: 'しょぼいカレンダー チャンネルマッピング (syobocalChannelMap)', value: 'syobocalChannelMap' },
        { title: 'シリーズ (series)', value: 'series' },
        { title: 'ダッシュボード (dashboard)', value: 'dashboard' },
    ];
    historyItems: apid.AppSettingHistoryItem[] = [];
    rollbacking = false;

    notificationFailures: apid.NotificationFailureHistoryItem[] = [];

    annictTesting = false;
    annictTestResult: string | null = null;

    channelMapEntries: ChannelMapEntryForm[] = [];
    channelMapSaving = false;
    channelItems: apid.ChannelItem[] = [];
    private channelMapKeySeed = 0;
    private nextChannelMapKey(): string {
        this.channelMapKeySeed += 1;
        return `channel-map-${Date.now()}-${this.channelMapKeySeed}`;
    }

    get channelSelectItems(): Array<{ title: string; value: number }> {
        return this.channelItems.map(c => ({ title: c.name, value: c.id }));
    }

    sharedDataSyncing = false;
    sharedDataSyncResult: string | null = null;

    syobocalTitleStatus: apid.SyobocalTitleDictionaryStatus | null = null;
    syobocalTitleSyncing = false;
    syobocalTitleSyncResult: string | null = null;

    annictWorkStatus: apid.AnnictWorkDictionaryStatus | null = null;
    annictWorkSyncing = false;
    annictWorkSyncResult: string | null = null;

    get backfillStateText(): string {
        const map: Record<string, string> = { idle: '未実行', running: '実行中', completed: '完了', canceled: 'キャンセル済み', failed: '失敗' };
        return this.backfillStatus ? (map[this.backfillStatus.state] ?? this.backfillStatus.state) : '';
    }

    get backfillProgressPercent(): number {
        if (this.backfillStatus === null || this.backfillStatus.total === 0) {
            return 0;
        }
        return Math.min(100, Math.round((this.backfillStatus.processed / this.backfillStatus.total) * 100));
    }

    formatDate(unixtimeMs: number): string {
        return DateUtil.format(new Date(unixtimeMs), 'yyyy/MM/dd hh:mm:ss');
    }

    settings: any = {
        metadata: {
            annict: { enabled: false, token: '', syncEnabled: true, workSyncIntervalMs: 7 * 24 * 60 * 60 * 1000 },
            syobocal: { enabled: false, titleSyncIntervalMs: 24 * 60 * 60 * 1000 },
            sharedData: { autoUpdate: true },
            endpoints: { syobocal: '', annict: '', fxtwitter: '', sharedData: '' },
            cacheTtlMs: 24 * 60 * 60 * 1000,
        },
        notifications: {
            enabled: false,
            maxAttempts: 5,
            baseDelayMs: 1000,
            timeoutMs: 10000,
            targets: [] as NotificationTargetForm[],
        },
        series: { matchThreshold: 0.8 },
        // ログレベル。未指定 (null) のカテゴリはログ設定ファイルの値をそのまま使う
        logging: { levels: {} as Record<string, string | null> },
    };

    readonly logCategories = [
        { title: 'システム', value: 'system' },
        { title: 'アクセス', value: 'access' },
        { title: 'ストリーム', value: 'stream' },
        { title: 'エンコード', value: 'encode' },
    ];
    readonly logLevelItems = [
        { title: 'trace (最も詳細)', value: 'trace' },
        { title: 'debug', value: 'debug' },
        { title: 'info', value: 'info' },
        { title: 'warn', value: 'warn' },
        { title: 'error', value: 'error' },
        { title: 'fatal', value: 'fatal' },
        { title: 'off (出力しない)', value: 'off' },
    ];

    private targetKeySeed = 0;
    private nextTargetKey(): string {
        this.targetKeySeed += 1;
        return `target-${Date.now()}-${this.targetKeySeed}`;
    }

    async mounted() {
        // 認証有効時、一般ユーザーはこの画面を開けない (API 側も 403 で弾く)
        await this.loadAuth();
        if (this.isAdmin === false) {
            this.snackbarState.open({ color: 'error', text: 'システム管理者のみが利用できます' });
            await this.$router.replace('/settings');
            return;
        }
        if (isFeatureEnabled(this.serverConfigModel.getConfig(), 'systemSettings') === false) {
            this.snackbarState.open({ color: 'error', text: 'サーバー設定機能は無効化されています' });
            await this.$router.replace('/settings');
            return;
        }
        try {
            const loaded = await this.api.get();
            this.settings = {
                ...this.settings,
                ...loaded,
                metadata: {
                    ...this.settings.metadata,
                    ...loaded.metadata,
                    annict: { ...this.settings.metadata.annict, ...loaded.metadata?.annict },
                    syobocal: { ...this.settings.metadata.syobocal, ...loaded.metadata?.syobocal },
                    sharedData: { ...this.settings.metadata.sharedData, ...loaded.metadata?.sharedData },
                    endpoints: { ...this.settings.metadata.endpoints, ...loaded.metadata?.endpoints },
                },
                notifications: { ...this.settings.notifications, ...loaded.notifications },
                series: { ...this.settings.series, ...loaded.series },
                logging: { levels: { ...((loaded as any).logging?.levels ?? {}) } },
            };
            this.settings.notifications.targets = (loaded.notifications?.targets ?? []).map((t: any) => ({
                __key: this.nextTargetKey(),
                name: t.name ?? '',
                type: t.type ?? 'discord',
                url: t.url ?? '',
                secret: t.secret ?? '',
                events: t.events ?? [],
            }));
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'システム設定の取得に失敗しました' });
        }

        try {
            this.channelItems = await this.channelsApi.getChannels();
        } catch (err) {
            console.error(err);
        }
        await this.loadChannelMap();
        await this.refreshSyobocalTitleStatus();
        await this.refreshAnnictWorkStatus();

        if (this.isEnabledSeriesLibrary === true) {
            await this.refreshBackfillStatus();
            await this.loadAliases();
            await this.loadEmptySeries();
            await this.loadMetrics();
        }
        await this.loadHistory();
        await this.loadNotificationFailures();
        await this.loadVideoMetadataStatus();
        await this.loadTsInfoStatus();
        // 画面を開き直したときに、実行中のジョブがあれば進捗の続きを表示する
        await this.loadAnalyzeJob();
    }

    /**
     * 録画ファイルメタデータの解析状況を取得する
     */
    async loadVideoMetadataStatus(): Promise<void> {
        this.videoMetadataLoading = true;
        try {
            this.videoMetadataStatus = await this.videoApi.getMetadataStatus();
        } catch (err) {
            console.error(err);
        } finally {
            this.videoMetadataLoading = false;
        }
    }

    /**
     * 録画ファイルの TS 解析状況を取得する
     */
    async loadTsInfoStatus(): Promise<void> {
        this.tsInfoLoading = true;
        try {
            this.tsInfoStatus = await this.videoApi.getTsInfoStatus();
        } catch (err) {
            console.error(err);
        } finally {
            this.tsInfoLoading = false;
        }
    }

    /**
     * 一括解析ジョブを開始する。
     * 処理はサーバー側で進むため、画面を閉じても止まらない
     * @param type: 解析の種別
     * @param mode: 対象 (未解析のみ / 全件強制)
     */
    async startAnalyzeJob(type: apid.VideoAnalyzeJobType, mode: apid.VideoAnalyzeJobMode): Promise<void> {
        try {
            this.analyzeJob = await this.videoApi.startAnalyzeJob({ type: type, mode: mode });
            this.startAnalyzeJobPolling();
        } catch (err: any) {
            console.error(err);
            const message = err?.response?.status === 409 ? 'すでに解析ジョブが実行中です' : '解析ジョブの開始に失敗しました';
            this.snackbarState.open({ color: 'error', text: message });
        }
    }

    /**
     * 実行中の一括解析ジョブに中断を要求する
     */
    async cancelAnalyzeJob(): Promise<void> {
        try {
            this.analyzeJob = await this.videoApi.cancelAnalyzeJob();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '解析ジョブの中断に失敗しました' });
        }
    }

    /**
     * 画面を開いたときに、実行中・直近のジョブを取得して表示に反映する
     */
    async loadAnalyzeJob(): Promise<void> {
        try {
            this.analyzeJob = await this.videoApi.getAnalyzeJob();
            if (this.isAnalyzeJobRunning === true) this.startAnalyzeJobPolling();
        } catch (err) {
            console.error(err);
        }
    }

    private startAnalyzeJobPolling(): void {
        this.stopAnalyzeJobPolling();
        this.analyzeJobTimer = window.setInterval(async () => {
            try {
                this.analyzeJob = await this.videoApi.getAnalyzeJob();
                if (this.isAnalyzeJobRunning === true) return;

                this.stopAnalyzeJobPolling();
                // 終了時は件数表示も取り直す
                await this.loadVideoMetadataStatus();
                await this.loadTsInfoStatus();
                if (this.analyzeJob.status === 'succeeded') {
                    this.snackbarState.open({
                        color: this.analyzeJob.failed === 0 ? 'success' : 'error',
                        text: `解析が完了しました: 成功 ${this.analyzeJob.analyzed} 件 / 失敗 ${this.analyzeJob.failed} 件`,
                    });
                } else if (this.analyzeJob.status === 'failed') {
                    this.snackbarState.open({ color: 'error', text: '解析ジョブが中断しました' });
                }
            } catch (err) {
                console.error(err);
            }
        }, SystemSetting.ANALYZE_JOB_POLLING_INTERVAL);
    }

    private stopAnalyzeJobPolling(): void {
        if (this.analyzeJobTimer !== null) {
            window.clearInterval(this.analyzeJobTimer);
            this.analyzeJobTimer = null;
        }
    }

    beforeUnmount() {
        this.stopBackfillPolling();
        // ジョブ自体はサーバー側で進み続けるので、ここでは進捗の取得だけをやめる
        this.stopAnalyzeJobPolling();
    }

    addNotificationTarget(): void {
        this.settings.notifications.targets.push({
            __key: this.nextTargetKey(),
            name: `target-${this.settings.notifications.targets.length + 1}`,
            type: 'discord',
            url: '',
            secret: '',
            events: ['recording.started', 'recording.completed', 'recording.failed'],
        });
    }

    removeNotificationTarget(index: number | string): void {
        this.settings.notifications.targets.splice(Number(index), 1);
    }

    onTargetNameChanged(target: NotificationTargetForm): void {
        target.__renamed = true;
    }

    async loadMetrics(): Promise<void> {
        try {
            this.metrics = await this.seriesApi.getMetrics();
        } catch (err) {
            console.error(err);
        }
    }

    async loadHistory(): Promise<void> {
        try {
            this.historyItems = await this.api.getHistory(this.historyKey);
        } catch (err) {
            console.error(err);
            this.historyItems = [];
        }
    }

    async rollback(): Promise<void> {
        this.rollbacking = true;
        try {
            const result = await this.api.rollback(this.historyKey);
            this.applyUpdateResult(result);
            this.snackbarState.open({ color: 'success', text: 'ロールバックしました' });
            await this.loadHistory();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'ロールバックに失敗しました' });
        } finally {
            this.rollbacking = false;
        }
    }

    async loadNotificationFailures(): Promise<void> {
        try {
            this.notificationFailures = await this.api.getNotificationFailures(50);
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * 接続テストのエラーコードを、次に何をすればよいか分かる日本語へ変換する
     * @param message: string | undefined サーバから返るエラーコード
     * @return string 表示用メッセージ
     */
    private annictErrorText(message: string | undefined): string {
        const map: Record<string, string> = {
            AnnictIsDisabled: 'Annict 連携が無効です。上のスイッチを ON にして「保存」してから再度お試しください',
            AnnictTokenIsNotConfigured: 'アクセストークンが未設定です。トークンを入力して「保存」してから再度お試しください',
            AnnictAuthenticationFailed: 'アクセストークンが無効です。annict.com で発行し直してください',
            MetadataProvidersFeatureIsDisabled: 'config.yml の featureFlags.metadataProviders が無効です',
        };
        return map[message ?? ''] ?? `疎通確認に失敗しました (${message ?? '不明なエラー'})`;
    }

    async testAnnictConnection(): Promise<void> {
        this.annictTesting = true;
        this.annictTestResult = null;
        try {
            const result = await this.api.testAnnictConnection();
            this.annictTestResult = result.ok ? `接続に成功しました (ユーザー: ${result.username ?? '-'})` : this.annictErrorText(result.message);
        } catch (err: any) {
            console.error(err);
            const status = err?.response?.status;
            this.annictTestResult = typeof status === 'number' ? `疎通確認に失敗しました (HTTP ${status})` : '疎通確認に失敗しました (通信エラー)';
        } finally {
            this.annictTesting = false;
        }
    }

    async loadChannelMap(): Promise<void> {
        try {
            const entries = await this.api.getSyobocalChannelMap();
            this.channelMapEntries = entries.map(e => ({
                __key: this.nextChannelMapKey(),
                __channelId: null,
                chId: e.chId,
                networkId: e.networkId,
                serviceId: e.serviceId,
                syobocal: e.syobocal !== false,
            }));
        } catch (err) {
            console.error(err);
        }
    }

    addChannelMapEntry(): void {
        this.channelMapEntries.push({
            __key: this.nextChannelMapKey(),
            __channelId: null,
            chId: null,
            networkId: null,
            serviceId: null,
            syobocal: true,
        });
    }

    removeChannelMapEntry(index: number): void {
        this.channelMapEntries.splice(index, 1);
    }

    /**
     * チャンネル一覧 (GET /api/channels) から選択した際、networkId/serviceId を自動補完する
     */
    onChannelSelected(entry: ChannelMapEntryForm, channelId: number): void {
        const channel = this.channelItems.find(c => c.id === channelId);
        if (channel) {
            entry.networkId = channel.networkId;
            entry.serviceId = channel.serviceId;
        }
    }

    async saveChannelMap(): Promise<void> {
        this.channelMapSaving = true;
        try {
            const payload = this.channelMapEntries.map(e => ({
                chId: e.chId ?? 0,
                networkId: e.networkId ?? 0,
                serviceId: e.serviceId ?? 0,
                syobocal: e.syobocal,
            }));
            const saved = await this.api.updateSyobocalChannelMap(payload);
            this.channelMapEntries = saved.map(e => ({
                __key: this.nextChannelMapKey(),
                __channelId: null,
                chId: e.chId,
                networkId: e.networkId,
                serviceId: e.serviceId,
                syobocal: e.syobocal !== false,
            }));
            this.snackbarState.open({ color: 'success', text: 'チャンネルマッピング表を保存しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'チャンネルマッピング表の保存に失敗しました' });
        } finally {
            this.channelMapSaving = false;
        }
    }

    async syncSharedDataNow(): Promise<void> {
        this.sharedDataSyncing = true;
        this.sharedDataSyncResult = null;
        try {
            const result = await this.api.syncSharedData();
            this.sharedDataSyncResult = result.updated ? '同期が完了しました' : '取得できるデータがありませんでした (URL 未設定または取得失敗)';
        } catch (err) {
            console.error(err);
            this.sharedDataSyncResult = '同期に失敗しました';
        } finally {
            this.sharedDataSyncing = false;
        }
    }

    /**
     * しょぼいカレンダー アニメ作品タイトル辞書の状態を取得する
     */
    async refreshSyobocalTitleStatus(): Promise<void> {
        try {
            this.syobocalTitleStatus = await this.api.getSyobocalTitleStatus();
        } catch (err) {
            // 機能フラグ (metadataProviders) が無効な場合は 404 になるため、エラー表示はせず未取得のままにする
            console.error(err);
        }
    }

    /**
     * アニメ作品タイトル辞書を同期する
     * @param full: boolean true なら差分ではなく全件取り直す
     */
    async syncSyobocalTitles(full: boolean): Promise<void> {
        this.syobocalTitleSyncing = true;
        this.syobocalTitleSyncResult = null;
        try {
            const result = await this.api.syncSyobocalTitles(full);
            this.syobocalTitleStatus = result;
            this.syobocalTitleSyncResult =
                result.error === null
                    ? `${result.imported.toLocaleString()} 件を取り込みました (登録作品数 ${result.titleCount.toLocaleString()})`
                    : `同期に失敗しました: ${result.error}`;
        } catch (err) {
            console.error(err);
            this.syobocalTitleSyncResult = '同期に失敗しました';
            this.snackbarState.open({ color: 'error', text: 'アニメ作品タイトル辞書の同期に失敗しました' });
        } finally {
            this.syobocalTitleSyncing = false;
        }
    }

    /**
     * Annict 作品辞書の状態を取得する
     */
    async refreshAnnictWorkStatus(): Promise<void> {
        try {
            this.annictWorkStatus = await this.api.getAnnictWorkStatus();
        } catch (err) {
            // 機能フラグ (metadataProviders) が無効な場合は 404 になるため、エラー表示はせず未取得のままにする
            console.error(err);
        }
    }

    /**
     * Annict 作品辞書を同期する (常に全件取得)
     */
    async syncAnnictWorks(): Promise<void> {
        this.annictWorkSyncing = true;
        this.annictWorkSyncResult = null;
        try {
            const result = await this.api.syncAnnictWorks();
            this.annictWorkStatus = result;
            this.annictWorkSyncResult =
                result.error === null
                    ? `${result.imported.toLocaleString()} 件を取り込みました (しょぼいカレンダーと結合済 ${result.linkedToSyobocalCount.toLocaleString()} 件)`
                    : `同期に失敗しました: ${result.error}`;
        } catch (err) {
            console.error(err);
            this.annictWorkSyncResult = '同期に失敗しました';
            this.snackbarState.open({ color: 'error', text: 'Annict 作品辞書の同期に失敗しました' });
        } finally {
            this.annictWorkSyncing = false;
        }
    }

    async refreshBackfillStatus(): Promise<void> {
        try {
            this.backfillStatus = await this.seriesApi.getBackfillStatus();
            if (this.backfillStatus.state === 'running') {
                this.startBackfillPolling();
            } else {
                this.stopBackfillPolling();
            }
        } catch (err) {
            // シリーズ機能無効時 (404) 等は静かに無視する
            console.error(err);
        }
    }

    startBackfillPolling(): void {
        if (this.backfillPollTimer !== null) {
            return;
        }
        this.backfillPollTimer = setInterval(() => {
            void this.refreshBackfillStatus();
        }, 2000);
    }

    stopBackfillPolling(): void {
        if (this.backfillPollTimer !== null) {
            clearInterval(this.backfillPollTimer);
            this.backfillPollTimer = null;
        }
    }

    async startBackfill(dryRun: boolean): Promise<void> {
        this.backfillStarting = true;
        try {
            const latest = parseInt(this.backfillLatest, 10);
            this.backfillStatus = await this.seriesApi.startBackfill({
                dryRun,
                onlyUnlinked: this.backfillOnlyUnlinked,
                latest: isNaN(latest) === true || latest < 1 ? undefined : latest,
            });
            this.snackbarState.open({ color: 'success', text: dryRun ? 'ドライランを開始しました' : 'バックフィルを開始しました' });
            this.startBackfillPolling();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'バックフィルの開始に失敗しました' });
        } finally {
            this.backfillStarting = false;
        }
    }

    async cancelBackfill(): Promise<void> {
        try {
            await this.seriesApi.cancelBackfill();
            this.snackbarState.open({ color: 'success', text: 'バックフィルをキャンセルしました' });
            await this.refreshBackfillStatus();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'キャンセルに失敗しました' });
        }
    }

    async loadAliases(): Promise<void> {
        try {
            this.aliases = await this.seriesApi.listAliases();
        } catch (err) {
            console.error(err);
        }
    }

    get isAllEmptySeriesSelected(): boolean {
        return this.emptySeries.length > 0 && this.selectedEmptySeriesIds.length === this.emptySeries.length;
    }

    /**
     * 録画 0 件のシリーズを全件選択 / 選択解除する
     * @param value: boolean | null チェック状態
     */
    toggleAllEmptySeries(value: boolean | null): void {
        this.selectedEmptySeriesIds = value === true ? this.emptySeries.map(s => s.seriesId) : [];
    }

    /**
     * 録画 0 件のシリーズ一覧を取得する
     */
    async loadEmptySeries(): Promise<void> {
        this.emptySeriesLoading = true;
        try {
            const result = await this.seriesApi.listEmptySeries();
            this.emptySeries = result.items;
            // 削除済み / 録画が紐づいたシリーズを選択に残さない
            const ids = new Set(result.items.map(s => s.seriesId));
            this.selectedEmptySeriesIds = this.selectedEmptySeriesIds.filter(id => ids.has(id));
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '録画 0 件のシリーズの取得に失敗しました' });
        } finally {
            this.emptySeriesLoading = false;
        }
    }

    /**
     * 録画 0 件のシリーズを削除する
     * @param all: boolean true の場合は一覧にある空シリーズをすべて削除する
     */
    async deleteEmptySeries(all: boolean): Promise<void> {
        const targets = all === true ? this.emptySeries.map(s => s.seriesId) : this.selectedEmptySeriesIds;
        if (targets.length === 0) return;
        if (window.confirm(`録画 0 件のシリーズ ${targets.length} 件を削除しますか? (録画ファイルは削除されません)`) === false) return;

        this.emptySeriesDeleting = true;
        try {
            const result = await this.seriesApi.deleteEmptySeries(targets);
            this.snackbarState.open({
                color: 'success',
                text: `シリーズ ${result.deletedSeriesCount} 件 / 辞書 ${result.deletedAliasCount} 件 / エピソード ${result.deletedEpisodeCount} 件を削除しました`,
            });
            this.selectedEmptySeriesIds = [];
            await this.loadEmptySeries();
            await this.loadAliases();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '録画 0 件のシリーズの削除に失敗しました' });
        } finally {
            this.emptySeriesDeleting = false;
        }
    }

    /**
     * 検索結果 1 件を一意に識別するキー (外部 ID の組)
     */
    dictionaryWorkKey(work: DictionaryWorkItem): string {
        return `${work.syobocalTid ?? ''}:${work.annictId ?? ''}:${work.wikidataQid ?? ''}`;
    }

    /**
     * 辞書の出所を日本語表記にする
     */
    dictionarySourceLabel(source: string): string {
        if (source === 'syobocal') return 'しょぼいカレンダー';
        if (source === 'annict') return 'Annict';
        if (source === 'wikidata') return 'Wikidata';
        return source;
    }

    /**
     * クール表示 (例: 2025 春)。不明なら '-'
     */
    dictionarySeasonLabel(work: DictionaryWorkItem): string {
        const names: { [key: string]: string } = { WINTER: '冬', SPRING: '春', SUMMER: '夏', AUTUMN: '秋' };
        const season = typeof work.seasonName === 'string' ? (names[work.seasonName] ?? '') : '';
        if (typeof work.seasonYear !== 'number') return season === '' ? '-' : season;
        return season === '' ? `${work.seasonYear}` : `${work.seasonYear} 年 ${season}`;
    }

    /**
     * 外部 ID を 1 行にまとめて表示する
     */
    dictionaryIdsLabel(work: DictionaryWorkItem): string {
        const ids: string[] = [];
        if (typeof work.syobocalTid === 'number') ids.push(`TID ${work.syobocalTid}`);
        if (typeof work.annictId === 'number') ids.push(`Annict ${work.annictId}`);
        if (typeof work.wikidataQid === 'string' && work.wikidataQid !== '') ids.push(work.wikidataQid);
        return ids.length === 0 ? '-' : ids.join(' / ');
    }

    /**
     * 同期済みの作品辞書をキーワードで横断検索する
     */
    async searchDictionary(): Promise<void> {
        const keyword = (this.dictionaryKeyword ?? '').trim();
        if (keyword.length < 2) return;
        this.dictionarySearching = true;
        try {
            const result = await this.seriesApi.searchDictionary(keyword);
            this.dictionaryWorks = result.items;
            this.dictionarySearched = true;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '作品辞書の検索に失敗しました' });
        } finally {
            this.dictionarySearching = false;
        }
    }

    /**
     * 辞書の作品からシリーズを作る。
     * 作成後は付け替え先の候補としてすぐに選べるようエイリアス一覧も読み直す
     */
    async createSeriesFromDictionary(work: DictionaryWorkItem): Promise<void> {
        this.dictionaryCreatingKey = this.dictionaryWorkKey(work);
        try {
            const result = await this.seriesApi.createSeriesFromDictionary(work);
            this.snackbarState.open({
                color: 'success',
                text: result.created === true ? `シリーズ「${result.title}」を作成しました` : `シリーズ「${result.title}」はすでに登録されています`,
            });
            this.dictionaryWorks = this.dictionaryWorks.map(x => (this.dictionaryWorkKey(x) === this.dictionaryWorkKey(work) ? { ...x, seriesId: result.seriesId } : x));
            await this.loadAliases();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '辞書からのシリーズ作成に失敗しました' });
        } finally {
            this.dictionaryCreatingKey = null;
        }
    }

    /**
     * 付け替え先の候補をサーバから検索する (オートコンプリートの入力に追従)
     */
    @Watch('aliasSearchKeyword')
    @Watch('bulkAliasKeyword')
    onSeriesSearchKeywordChanged(): void {
        const keyword = (this.aliasSearchKeyword || this.bulkAliasKeyword || '').trim();
        if (this.seriesSearchTimer !== null) clearTimeout(this.seriesSearchTimer);
        // 1 文字打つたびに問い合わせないよう少し待つ
        this.seriesSearchTimer = setTimeout(() => {
            void this.searchSeriesCandidates(keyword);
        }, 300);
    }

    async searchSeriesCandidates(keyword: string): Promise<void> {
        this.seriesSearching = true;
        try {
            const result = await this.seriesApi.list({ keyword: keyword || undefined, offset: 0, limit: 50 });
            this.seriesCandidates = result.items;
        } catch (err) {
            console.error(err);
        } finally {
            this.seriesSearching = false;
        }
    }

    /**
     * 編集した辞書 (付け替え / 削除) をまとめて保存する。
     * 付け替えたものはサーバ側で手動修正扱い (source: 'manual') になる
     */
    async saveAliases(): Promise<void> {
        const items = this.changedAliasItems;
        if (items.length === 0) return;
        this.aliasSaving = true;
        try {
            const result = await this.seriesApi.updateAliasBulk(items);
            if (result.failed.length > 0) {
                this.snackbarState.open({
                    color: 'error',
                    text: `付け替え ${result.updated} 件 / 削除 ${result.removed} 件を保存しましたが ${result.failed.length} 件失敗しました`,
                });
                console.error(result.failed);
            } else {
                this.snackbarState.open({
                    color: 'success',
                    text: `付け替え ${result.updated} 件 / 削除 ${result.removed} 件を保存しました`,
                });
            }
            this.aliasEdits = {};
            this.selectedAliasIds = [];
            await this.loadAliases();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'エイリアス辞書の保存に失敗しました' });
        } finally {
            this.aliasSaving = false;
        }
    }

    async removeAlias(aliasId: number): Promise<void> {
        try {
            await this.seriesApi.removeAlias(aliasId);
            await this.loadAliases();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'エイリアスの削除に失敗しました' });
        }
    }

    async testNotification(targetName: string) {
        this.testingTargetName = targetName;
        try {
            const result = await this.api.testNotification(targetName);
            if (result.failed.length > 0) {
                this.snackbarState.open({ color: 'error', text: `テスト通知に失敗しました: ${result.failed.join('、')}` });
            } else {
                this.snackbarState.open({ color: 'success', text: 'テスト通知を送信しました' });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'テスト通知の送信に失敗しました (先に保存が必要な場合があります)' });
        } finally {
            this.testingTargetName = null;
        }
    }

    private applyUpdateResult(result: apid.AppSettingUpdateResult): void {
        this.requiresRestartKeys = result.requiresRestartKeys;
        const loaded = result.settings;
        this.settings = {
            ...this.settings,
            ...loaded,
            metadata: {
                ...this.settings.metadata,
                ...loaded.metadata,
                annict: { ...this.settings.metadata.annict, ...(loaded.metadata as any)?.annict },
                syobocal: { ...this.settings.metadata.syobocal, ...(loaded.metadata as any)?.syobocal },
                sharedData: { ...this.settings.metadata.sharedData, ...(loaded.metadata as any)?.sharedData },
                endpoints: { ...this.settings.metadata.endpoints, ...(loaded.metadata as any)?.endpoints },
            },
            notifications: { ...this.settings.notifications, ...loaded.notifications },
            series: { ...this.settings.series, ...loaded.series },
            logging: { levels: { ...((loaded as any).logging?.levels ?? {}) } },
        };
        this.settings.notifications.targets = ((loaded.notifications as any)?.targets ?? []).map((t: any) => ({
            __key: this.nextTargetKey(),
            name: t.name ?? '',
            type: t.type ?? 'discord',
            url: t.url ?? '',
            secret: t.secret ?? '',
            events: t.events ?? [],
        }));
    }

    /**
     * 未指定 (クリアした) カテゴリは送らず、ログ設定ファイルの値をそのまま使わせる
     */
    private buildLogLevels(): Record<string, string> {
        const levels: Record<string, string> = {};
        for (const category of this.logCategories) {
            const value = this.settings.logging.levels[category.value];
            if (typeof value === 'string' && value !== '') levels[category.value] = value;
        }
        return levels;
    }

    async save() {
        this.saving = true;
        try {
            const payload = {
                metadata: this.settings.metadata,
                notifications: {
                    ...this.settings.notifications,
                    targets: this.settings.notifications.targets.map((t: NotificationTargetForm) => ({
                        name: t.name,
                        type: t.type,
                        url: t.url,
                        secret: t.secret,
                        events: t.events,
                    })),
                },
                series: this.settings.series,
                logging: { levels: this.buildLogLevels() },
            };
            const result = await this.api.update(payload);
            this.applyUpdateResult(result);
            this.snackbarState.open({ color: 'success', text: '保存しました' });
            await this.loadHistory();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '保存に失敗しました' });
        } finally {
            this.saving = false;
        }
    }
}
export default toNative(SystemSetting);
</script>

<style lang="sass" scoped>
// エイリアス辞書の表
// 列幅を px ではなく割合 (%) で指定し、ビューポート幅に応じて伸縮させる
.alias-table
    :deep(table)
        table-layout: fixed
        width: 100%

    :deep(th), :deep(td)
        overflow: hidden

    .alias-col-check
        width: 4%
        min-width: 40px

    .alias-col-normalized
        width: 33%

    .alias-col-series
        width: 35%

    .alias-col-source
        width: 10%

    .alias-col-date
        width: 12%

    .alias-col-action
        width: 6%

// 長い正規化タイトルは列幅に収めて末尾を省略する
.alias-normalized-cell
    white-space: nowrap
    overflow: hidden
    text-overflow: ellipsis

.alias-removed
    opacity: 0.6

// 狭いビューポートでは登録日時を隠し、その分をタイトルとシリーズに配分する
@media screen and (max-width: 960px)
    .alias-table
        .alias-col-normalized
            width: 38%

        .alias-col-series
            width: 40%

        .alias-col-source
            width: 12%

        .alias-col-action
            width: 6%

    .alias-date-cell
        display: none
</style>
