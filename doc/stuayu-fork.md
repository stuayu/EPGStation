# このフォークプロジェクトについて
このフォーク版EPGStationを利用するには[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)が必要です。  
[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)は本家EPGStation環境下でも多分動作すると思いますが保証しません。
変更点などはコミットログや[変更箇所](#変更箇所)をご覧ください。

# windows用 mirakurun-epgstation セットアップガイド

- [このフォークプロジェクトについて](#このフォークプロジェクトについて)
- [windows用 mirakurun-epgstation セットアップガイド](#windows用-mirakurun-epgstation-セットアップガイド)
  - [Mirakurunインストール編](#mirakurunインストール編)
  - [EPGStationインストール編](#epgstationインストール編)
  - [変更箇所](#変更箇所)

## Mirakurunインストール編

改変版のMirakrunの導入について解説します.  
事前準備としてNodejs-LTSをインストールしてください。  
~~おすすめは[chocolatey](https://chocolatey.org/)をインストールしてから以下のコマンドを実行する方法です。~~   
Windows10/11から標準で利用可能になったwingetでインストールすることをお勧めします。  
公式サイトからのインストールでも動作します。   

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

- フォーク版Mirakurunを導入する
  1. [Github](https://github.com/stuayu/Mirakurun)からソースコードをクローンし、ビルドを行う。
        ```powershell
        git clone https://github.com/stuayu/Mirakurun -b stuayu-main
        cd Mirakurun
        npm install
        npm run build
        ``` 
  2. 各種設定ファイルの編集  
    チューナー・サーバ・チャンネルの設定ファイル：`Mirakurun\local_config`  
    サービスの**LOGデータ**・Logoデータ・番組情報・チャンネル情報の保存先：`Mirakurun\local_data`  
    新規インストール時`local_data`フォルダ内のデータを削除することをお勧めします。

  3. サービスとして登録
        ```powershell
        npm run postinstall -g # 管理者権限で実行する
        ```

  4. ブラウザからアクセスする  
    `http://127.0.0.1:40772` or `http://localhost:40772`でアクセスできます。  
    アクセスできない場合はMirakurunのログを確認してください、起動できない理由が書いてあるはずです。
  5. Mirakurunの削除方法
        ```powershell
        npm run preuninstall -g # 管理者権限で実行する
        ```
        エクスプローラー等でフォルダを削除する。  

## EPGStationインストール編
基本的には公式と一緒の手順です。  
改変前のEPGStationで実行したバックアップはルール予約のみ互換性がありません。手動でバックアップファイル内の予約データの箇所を削除するか、  
GR,BS,CSの箇所をNW1~40のチャンネル空間を追加することで正常にリストアできます。  
過去すでにMySQL(MariaDB)などを利用していた場合には、テーブルをドロップして再びテーブルを作成してください。
  
  0. EPGStationデータベースからバックアップを作成する(データを引き継ぐ場合)
        ```powershell
        npm run backup {今日の日付など}.sql
        ```
        作成された`{今日の日付など}.sql`を保存しておいてください。  
        バックアップが完了したのち、データベースのテーブルを削除しておきます。

  1. [Github](https://github.com/stuayu/EPGStation)からソースコードをクローンし、ビルドを行う。

        ```powershell
        git clone https://github.com/stuayu/EPGStation -b main
        cd EPGStation
        npm run all-install
        npm run build-win # Windowsの場合のみ実行する
        npm run build # Linux/Macの場合のみ実行する
        ```

  2. 設定ファイルの編集  
    `config`フォルダ内に配置されているyamlファイルを各自にあった、設定ファイルに変更してください。

  3. Windowsサービスとして登録  

        ```powershell
        npm run install-win-service # 管理者権限必須
        ```
        エラーが起きた場合は管理者権限で`SC stop epgstation`と`SC delete epgstation`を実行してください。  
        存在してしまっているサービスを削除することができます。  
   4. MariaDBのインストール
      1. epgstationテーブルのセットアップ
            ```powershell
            winget install MariaDB.Server
            ```
      2. epgstationテーブルへのアクセス権設定（LinuxでもWindowsでも可能）  
         Windows環境の場合、環境変数にmysqlが登録されていない場合は、mysqlが見つからない場合があります。  
         Windows環境ではGUIで設定ができますので、以下の記事を参考に設定を行ってください。  
         https://zenn.dev/stuayu/articles/412f3faf5713a0
            ```powershell
            mysql -u root -e 'CREATE DATABASE epgstation CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;'
            mysql -u root -e 'CREATE USER "epgstation"@"localhost" IDENTIFIED BY "epgstation";'
            mysql -u root -e 'GRANT ALL ON epgstation.* TO "epgstation"@"localhost";'
            ```
      3. バックアップしたデータの復元
            > [!IMPORTANT]
            > バックアップファイルからの復元は、EPGStationがWebから正常にアクセスできることを確認した後に行ってください。

            ```powershell
            npm run restore {今日の日付など}.sql
            ```
            復元作業中に、ruleの部分で失敗する場合は、手動でsqlファイルを修正してください。
## 変更箇所

- 視聴体験まわり (S2・S4・S17) の欠陥修正と未実装機能を追加（クライアント側のみ、サーバ変更なし）
  - **機能フラグ未ゲートの導線を全面ゲート**: ダッシュボードの新規カード (ストレージ使用状況・録り逃しアラート)、Next Up パネル、Settings の Next Up 関連設定を `isFeatureEnabled()` (`client/src/util/FeatureFlags.ts`) で判定して表示するよう統一。全フラグ既定 OFF の環境では追加した導線は一切表示されない
  - **S2 視聴履歴・未視聴バッジ**
    - `RecordedUtil.convertRecordedItemToDisplayData()` が `watchHistory` フラグ有効時に「未視聴 (履歴なし)/視聴中 (進捗バー付き)/視聴済み」の 3 状態を正しく出し分けるよう修正 (`display.watchStatus`)。`RecordedSmallCard.vue` / `RecordedLargeCard.vue` のバッジ表示・色分けは共通ユーティリティ `client/src/util/WatchStatusUtil.ts` に集約
    - `VideoContainer.vue`: レジューム位置適用 (`applyResumePosition()`, GET 待ち) が完了するまで `resumeReady` フラグで再生位置保存 (`onTimeupdate`/`savePlaybackPosition`) を抑止し、最初の timeupdate が position≈0 を PUT して履歴を上書きするレースを解消
    - `VideoContainer.vue`: `pagehide` / `visibilitychange` (hidden 時) にも `savePlaybackPositionWithBeacon()` を紐付け、タブを閉じる・リロード・バックグラウンド化時にも再生位置が保存されるように変更 (登録した listener は `beforeUnmount` で解除)
    - `WatchRecordedInfoCard.vue` の `toggleWatched()` に try/catch と `duration<=0` の事前ガードを追加し、`ISnackbarState` でエラーを通知するよう修正 (従来は未処理の Promise rejection になっていた)
  - **S4 ホームダッシュボード**
    - `DashboardState.fetchData()` が `isHalfWidth` を送るよう修正 (`/dashboard` が常に 400 になっていた不具合)
    - `featureFlags.dashboard` が無効、もしくは集約 API 呼び出しが失敗した場合は `IReservesApiModel.getCnts()` による個別取得へ自動フォールバックし、`Dashboard.vue` 側の後続処理 (録画中/録画済み/予約の個別 API 取得) が確実に実行されるよう修正 (従来は catch 漏れで後続処理が止まっていた)
    - `featureFlags.dashboard` 有効時は `/dashboard` の結果 (`recording`/`recentlyRecorded`/`upcomingReserves`) を `IRecordingState`/`IRecordedState`/`IReservesState` に追加した `setData()` へそのまま反映し、個別 API への重複リクエストを排除 (真に 1 リクエスト集約になった)
    - ダッシュボードに新規カードを追加: ストレージ使用状況 (`DashboardStorageCard.vue`, 既存 `IStorageApiModel` を利用) / 録り逃しアラート (`DashboardMissingEpisodeCard.vue`, 直近更新シリーズ上位 15 件を対象に `GET /api/series/{id}/missing-episodes/proposals` をスキャンする軽量実装。シリーズ横断の欠番一覧 API がサーバに無いため全件走査ではない点に留意)。いずれも `featureFlags.dashboard` (欠番アラートは追加で `seriesLibrary` も) 連動で表示
  - **S17 Next Up パネル**
    - 連続再生を実装: `VideoContainer.vue` が残り再生時間 (`remainingTime`) と再生終了 (`ended`) を親へ emit し、`WatchRecorded.vue` が `NextUpPanel` へ中継。シリーズタブ選択時は常時、新着タブ選択時は設定 (`isEnableNextUpAutoPlayForLatestTab`, 既定 OFF、`Settings.vue` の Next Up パネル欄で ON 可) で有効な場合、再生終了 8 秒前に「次: 第 n 話」カウントダウンカードを表示し (キャンセルボタンあり)、カウント 0 で自動的に次話を再生する。次に再生する録画はシリーズタブでは話数昇順で現在より後の最小話数、無ければ未視聴優先、新着タブでは未視聴優先で解決
    - パネルにも視聴進捗バー・未視聴/視聴中/視聴済みバッジを表示 (`WatchStatusUtil` を再利用)
    - パネルの開閉状態・選択タブを `ISettingStorageModel` (`isNextUpPanelOpen` / `nextUpPanelTab`) に保存し次回視聴時に復元。既定タブが録画 ID 変更のたびにシリーズタブへ強制切替されていた不具合を修正 (ユーザー選択を尊重し、上書きしない)
    - キーボードショートカット `N` キーで次の録画を再生 (`document` レベルの keydown リスナー、input/textarea/contenteditable にフォーカス中は無視。将来のリモコン操作を見据えた設計)
    - `data === null` (ロード中/404) のとき「シリーズへ」ボタンが誤って表示される不具合を修正 (`data !== null && data.currentSeriesId !== null`)
    - `WatchRecorded.vue` が `featureFlags.nextUpPanel` を見ずにパネルを常時表示していた回帰を修正 (無効時はパネル自体を描画しない)
    - 録画詳細レスポンス自体には `seriesId`/`episodeNo` が無いため、シリーズタブ選択時に `ISeriesApiModel.get(seriesId)` (既存 API) から話数マップを解決して表示・連続再生の順序判定に使用 (サーバ側変更なし)

- システム設定 (S5/S6) の残作業を実装し、通知イベント種別を拡充（S1〜S7、サーバ側のみ）
  - **DI 登録漏れの修正**: `IAppSettingHistoryDB` / `INotificationQueueDB` が `ModelContainerSetter.ts` に未登録だったため起動時に DI 解決で落ちる不具合を修正
  - **`AppSettingApiModel` を全面改修**:
    - `AppSettingSchema.ts` の `validateAppSettingValue` による JSON Schema 検証を実際に適用
    - **マスク値の復元を配列インデックスから安定した識別子 (`name`) 突き合わせへ変更**。`notifications.targets` のようにインデックスがずれる (並べ替え・中間削除・先頭挿入) 操作をしてもシークレットが別ターゲットへ付け替わらないようにした。両配列の要素が一意な文字列 `name` を持つ場合のみ `name` で突き合わせ、持たない場合は従来通りインデックスにフォールバックする
    - **Discord Webhook URL 等の `url` も秘密情報として暗号化・マスク対象に追加** (`notifications.targets` 配下限定)。`NotificationDispatcher.getConfig()` も `url` を復号するよう追随
    - **復号失敗時のフォールバック**: secretKey 未設定・鍵ローテーション後で既存の暗号文が復号できない場合、`GET /api/settings/system` は 500 にせず、当該項目だけ `********(復号不可)` プレースホルダに差し替えて返す (画面は開ける)。secretKey 未設定時の更新失敗は `AppSettingSecretKeyIsNotConfigured` として 400 で返す
    - **マスク値の誤認防止**: マスク文字列 (`********...`) が来たのに対応する既存の暗号文が無い場合はエラーにし、マスク文字列自体を本物のシークレットとして保存してしまうバグを防ぐ
    - **v1→v2 鍵移行**: マスク値のまま更新された既存の v1 形式暗号文は、その更新のタイミングで v2 (scrypt + ソルト) へ再暗号化する
    - **変更履歴とロールバック**: `AppSettingHistory` に変更前値を記録し、`GET /api/settings/system/history?key=` (履歴一覧) / `POST /api/settings/system/rollback` (直前の状態への 1 回限りの undo) を追加
    - **requiresRestart**: 更新・ロールバック応答に `requiresRestart` / `requiresRestartKeys` を含め、変更されたキーが Operator の再初期化を要するかを返す (`AppSettingSchema.ts` の `requiresRestart` 宣言に追随。メタデータ/通知プロバイダはいずれも DB を都度読み直す実装のため、現行スキーマでは全キー `false`)
    - `AppSettingDB.getAll()` は行の JSON が壊れていても例外を投げず、その行だけ無視してログに残すよう修正 (壊れた 1 行で設定画面・ダッシュボード・通知が全滅するのを防ぐ)
  - **設定のホットリロード IPC (§6.3)**: 設定更新・ロールバック成功時に Service プロセスから Operator プロセスへ IPC で通知する仕組みを追加 (`ModelName.appSetting` / `AppSettingFunctions.notifyChanged`、`IAppSettingChangeEvent` / `AppSettingChangeEvent`)。対象モジュール (メタデータプロバイダー・通知) はいずれも DB 設定を都度読み直す実装のため、現時点では明示的な再初期化処理は不要だが、将来キャッシュを持つモジュールが増えた場合のフック地点として用意した。録画中の処理には一切影響しない fire-and-forget 通知
  - **通知イベント種別を追加し、実際に発火**: `recording.dropped` (ドロップ検出、`RecorderModel.updateDropFileLog()` でドロップ数 > 0 のとき)・`recording.missed` (録り逃し検出、`EventSetter` の録画リトライオーバー時)・`series.newEpisode` (シリーズ新話追加、`SeriesResolver.linkTo()` で新規エピソード行かつ初回放送と判定できた場合)・`storage.lowSpace` (ディスク残量低下、`StorageManageModel` で閾値を下回った時、同一ディレクトリへの連投を 30 分間隔で抑制)
  - **視聴履歴の孤児レコード対策**: `WatchHistoryDB.deleteByVideoFileId` / `deleteByRecordedId` を、録画削除・ビデオファイル個別削除の両方 (`RecordedManageModel.delete` / `deleteVideoFile`) から呼び出すようにした
  - **WatchHistory の status カラム整合**: mysql 用マイグレーション (`FixWatchHistoryStatusColumn`, varchar(20) 化) に対応する sqlite 側マイグレーションが無かったため追加 (テーブル再作成による移行、既存データは保持)
  - `api.yml` に `AppSettingValue` / `AppSettingUpdateResult` / `AppSettingHistoryItem` / `NotificationTestResult` / `NotificationFailureHistoryItem` のスキーマを追加し、同じ型を `api.d.ts` にも追加。`GET /api/settings/system/notifications/failures` (通知の失敗履歴取得、`INotificationDispatcher.getFailureHistory()` を公開) を新規追加
  - クライアント UI (変更履歴・ロールバック・requiresRestart の表示、失敗履歴一覧) は別ステップで対応予定

- 既存録画のシリーズ化バックフィルバッチを追加（S20、サーバ側のみ）
  - 提案書 §11.1 に対応。`seriesLibrary` 機能導入前から存在する既存録画に対し、`SeriesResolver.resolve()` を録画 id 昇順でチャンク分割しながら順次適用し、シリーズへのリンク付け・未確定キューへの積み込みを行うバックグラウンドジョブ (`ISeriesBackfillManageModel` / `SeriesBackfillManageModel`, `src/model/operator/series/`)。ジョブは Operator プロセスで実行し、他の recorded 系ジョブ (S18 の `ImportJobManageModel`) と同様に Service プロセスからは IPC (`ModelName.series` / `SeriesFunctions.startBackfill` / `getBackfillStatus` / `cancelBackfill`) 経由で操作する
  - **チャンク分割・低優先度**: 1 チャンクあたり既定 50 件 (`chunkSize` で変更可、1〜500 にクランプ) を `IRecordedDB.findForSeriesBackfill(afterId, limit)` (id 昇順・録画中を除く) で取得して処理し、チャンク間に既定 500ms (`intervalMs` で調整可、テスト用) の待機を挟むことで SQLite への録画書き込みと継続的に競合しないようにする。各チャンクは独立した小さな DB 呼び出しの集合であり、バックフィル全体を単一の長時間トランザクションにはしない
  - **中断・再開が自由**: 進捗 (状態・カウンタ・再開カーソル `lastRecordedId`) を `IAppSettingDB` (キー `seriesBackfill`) へチャンク完了毎に永続化する。`DELETE /api/series/backfill` でのキャンセルはもちろん、Operator プロセスが異常終了して `state: 'running'` のまま保存されていた場合も次回起動時に読み込むタイミングで `canceled` 扱いへ補正し、次の `start()` 呼び出しで `lastRecordedId` の続きから再開する (処理は `SeriesResolver.resolve()` 側が manualLock を除き冪等なため、万一同じ録画を再処理しても結果は変わらない)
  - **manualLock はスキップ**: 録画に既存の手動確定リンク (`manualLock: true`) がある場合は `SeriesResolver.resolve()` を呼ばずスキップ件数としてカウントする
  - **進捗取得**: 総件数 (処理済み + 残件数として都度再計算)・処理済み・リンク作成数・未確定キュー行き数・スキップ数・失敗数・状態 (`idle`/`running`/`completed`/`canceled`/`failed`) を返す
  - **ドライラン**: `dryRun: true` を指定すると、`SeriesResolver` のエイリアス優先→類似度スコアリングの判定ロジックのみを (DB 書き込みなしで) 再現し、録画ごとに確定シリーズ (または新規作成予定) か未確定候補 (上位 3 件) かをプレビューとして返す (`previewItems`、上限 2000 件を超えた分は `previewTruncated: true`)。ドライランは実バックフィルの再開カーソルに影響を与えないよう常にカーソル 0 から独立実行し、`IAppSettingDB` への永続化も行わない
  - API: `POST /api/series/backfill` (開始、body: `SeriesBackfillOption { dryRun?, chunkSize? }`)・`GET /api/series/backfill/status` (進捗取得)・`DELETE /api/series/backfill` (キャンセル)。機能フラグ `seriesLibrary` が無効な場合は他の series 系エンドポイントと同様に 404 を返す
  - `api.yml` に `SeriesBackfillOption` / `SeriesBackfillState` / `SeriesBackfillPreviewCandidate` / `SeriesBackfillPreviewItem` / `SeriesBackfillResult` のスキーマを追加し、同じ型を `api.d.ts` にも追加
  - `IRecordedDB` に `findForSeriesBackfill` / `countForSeriesBackfill` (id 昇順チャンク取得・残件数取得、録画中は対象外) を追加。`ISeriesDB` に `findPendingMatchByRecordedId` (未確定キューの存在確認用) を追加。いずれも既存メソッドの挙動には影響しない追加のみ
  - クライアント UI (バックフィル開始・進捗表示・ドライランプレビュー画面) は別ステップで対応予定

- 高度タグ・全文検索・保存検索を追加（S19、サーバ側のみ）
  - 録画全文検索エンジン `RecordedKeywordSearch` を追加。AND / OR (`OR` / `|`) / 除外 (`-` / `!`) / `title:` `desc:` `ext:` `tag:` `ch:` のフィールド指定 / `"フレーズ"` 検索に対応し、`featureFlags.advancedSearch` が無効なときは従来と完全に同一の where 句 (name/description の AND OR) を返す
  - `RecordedTag` に `parentId` (階層タグ) を追加。`advancedSearch` 有効時は録画一覧のタグ絞り込み (`GET /api/recorded?tagId=`) で子孫タグの録画も含めるようにし、タグの親子付け替え時は自分自身・子孫を親にできないよう循環参照を防止 (`RecordedTagDB.getDescendantIds` / `updateOnce`)
  - 保存検索 (`SavedSearch`) を追加。名前・検索条件 (JSON 文字列)・ピン留めを保持し、`GET/POST /api/searches`・`GET/PUT/DELETE /api/searches/{searchId}` で CRUD 可能。`featureFlags.advancedSearch` が無効なときは 404 を返して機能を無効化 (Dashboard/AppSetting と同じ流儀)
  - DB マイグレーション (sqlite/mysql 両対応): `AddRecordedTagParent` (`recorded_tag.parentId` 列 + インデックス追加)、`AddSavedSearch` (`saved_search` テーブル新規追加)
  - クライアント UI (検索バーの高度構文入力、階層タグ選択 UI、保存検索の一覧・保存操作) は別ステップで対応予定

- 外部録画ファイル (EDCB 等) の取り込み機能を追加・全面改修（S18）
  - **セキュリティ修正**: 初期実装 (`3f3e9c1d`) はクライアントから渡された任意の絶対パスをそのまま扱っており、サーバ上の任意ファイルの読み取り・移動・削除が可能だった。以下の対策を実施
    - `config.importDirs` (`IConfigFile.ImportDirInfo[]`) で明示的に許可したディレクトリ以外は一切取り込めない。未設定 (既定 `[]`) の場合は機能自体が無効
    - パス検証は `fs.realpath` でシンボリックリンクを解決したうえで `importDirs` の実ディレクトリ配下かどうかを `path.relative` ベースで判定 (`src/model/recorded/import/ImportPathValidator.ts`)。Windows のドライブレター・UNC パス・大文字小文字/区切り文字の差異にも対応し、シンボリックリンク経由の脱出を防ぐ
    - `subDirectory` / スキャン時の `subPath` にも `..` トラバーサル検査を追加
    - 書き込み処理 (登録・移動) は他の recorded 系操作と同様に **IPC 経由で Operator プロセスが実行** するよう修正 (以前は Service プロセスの `RecordedApiModel` が Operator 用の `RecordedManageModel` インスタンスを直接呼び出しており、サムネイル生成・自動エンコード・socket.io 通知が発火しない不具合があった)
  - **取り込みモードを 2 種類に対応**: `register` (既定。元ファイルを一切移動・削除せず、`importDirs` のディレクトリ名をそのまま `parentDirectoryName` としてそのまま登録する) / `move` (録画ディレクトリへ移動する、従来の挙動)
    - `register` モードで追加した `VideoFile` には `isExternalFile` フラグを立て (マイグレーション `AddVideoFileIsExternal`)、EPGStation から削除しても DB の登録解除のみで元ファイルには一切触れないようにした
  - **EDCB メタデータ推定**: ファイル名パターン (プリセット + `config.importFileNamePatterns` によるカスタム正規表現) と `<ファイル名>.program.txt` / `<ファイル名>.err` の解析を純粋関数として実装 (`src/model/recorded/import/EDCBFileNameParser.ts` / `EDCBProgramTxtParser.ts` / `EDCBErrParser.ts`)。チャンネル名は `ChannelDB` の放送局一覧と突き合わせて `channelId` に変換
  - **重複検出**: `channelId` + 開始時刻 (±5分) が一致する既存 `Recorded` を検出し (`IRecordedDB.findDuplicateCandidates`)、スキャン結果に警告として返す。登録時は `skip` (取り込まない) / `add` (既存 recorded に video file を追加) / `newRecorded` (別録画として新規登録) を選択可能
  - **API を全面刷新**: `POST /api/recorded/import/scan` (ディレクトリスキャン・推定結果と重複警告を返す、副作用なし) → `POST /api/recorded/import` (登録をバックグラウンドジョブとして開始し jobId を返す) → `GET /api/recorded/import/status/{jobId}` (進捗取得) / `POST /api/recorded/import/status/{jobId}/retry` (失敗ファイルのみ再実行)。旧 `POST /api/recorded/import-external` (一括同期処理・脆弱) は廃止
  - **バックグラウンドジョブ**: `ImportJobManageModel` (Operator 側) が 1 件ずつ順次取り込み、進捗 (総数・完了数・成功/失敗数・結果一覧) をメモリ上に保持しポーリング可能にした。ffprobe 等の重い処理で API リクエストがブロックされないようにするため
  - **監視フォルダ (既定 OFF)**: `config.importWatch: true` にすると `ImportWatchManageModel` が `importWatchIntervalSec` 間隔で `importDirs` を走査し、チャンネル・時刻が推定でき重複が無いファイルを自動で取り込む (`register` モード既定)。処理済みファイルは `data/importWatchSeen.json` に永続化し再起動後も再取り込みしない
  - **機能フラグをクライアントに公開**: `GET /api/config` のレスポンスに `featureFlags` (段階導入フラグ一式) と `importDirs` (許可ディレクトリ名一覧) を追加し、クライアントはこれを見て `externalFileImport` が無効なら取り込み UI 自体を表示しない (`client/src/util/FeatureFlags.ts` の `isFeatureEnabled()` を他の機能フラグでも再利用可能な共通ヘルパーとして追加)
  - **クライアント UI**: アップロード画面のテキストエリア方式を廃止し、取り込み元ディレクトリ選択 → スキャン → 候補一覧 (推定番組名・放送局の編集、重複警告、モード/重複時挙動の選択) → 登録 → 進捗表示・失敗分再実行のウィザードに変更 (`RecordedUploadForm.vue` / `RecordedUploadState.ts`)
  - DB マイグレーション (sqlite/mysql 両対応): `AddVideoFileIsExternal` (`video_file.isExternalFile` 列追加)

- Next Up パネルを追加（S17）
  - 録画視聴画面の右側に最新録画 / 同シリーズのタブ切替パネルを追加
  - 同シリーズが判定済みの場合はシリーズ一覧への導線も表示
  - 既存の視聴履歴を流用し、視聴済み / 視聴中ラベルを表示
  - ストリーミング視聴中は現在の配信方式・画質モードを引き継いで次の録画を再生

- Annict GraphQL連携を追加（S16）
  - GUI保存済みトークンを実行時だけ復号し、Bearer認証で作品・エピソード情報を取得
  - Annict IDとsyobocalTidをシリーズへ同期するAPI・UIを追加
  - GraphQLエラー、認証エラー、無効設定、キャッシュ基盤に対応

- 再放送・欠番・複数局録画の分析を追加（S15）
  - シーズン別の欠番、同一話数の複数録画、話数不明録画をシリーズAPIで返却
  - 同一エピソードの既存録画がある場合は、再放送表記がなくても自動的にrerunへ分類
  - シリーズ詳細画面に欠番警告と複数録画表示を追加

- 番組表とシリーズの双方向連携を追加（S14）
  - EPG番組を正規化タイトル・シーズン・話数から遅延マッピングし、結果を永続化
  - 番組ダイアログの「シリーズ」ボタンから録画済みシリーズへ移動
  - EPG情報を地方局・未登録番組の補完ソースとして利用

- しょぼいカレンダープロバイダーを追加（S13）
  - TitleLookup / ProgLookup XMLを共通メタデータ形式へ変換
  - 設定GUIの有効化状態に連動し、作品・話数・サブタイトル・放送日時を取得
  - 地方局データがない場合もtitle-onlyとして作品情報を保持し、EPG側補完を妨げない

- 外部メタデータプロバイダー基盤を追加（S12）
  - 共通検索・詳細契約、レジストリ、横断検索、失敗分離、HTTP再試行・レート制御を追加
  - 24時間キャッシュとSQLite/MySQL/PostgreSQLマイグレーションを追加
  - プロバイダー一覧・横断検索APIを追加

- S12〜S16 の残作業 (Annict 双方向同期・共有静的データ・欠番判定強化・XML パーサ堅牢化) を追加
  - **Annict 視聴記録の双方向同期 (§5.5・S16)**: `IMetadataProvider` にオプショナルな `pushWatchRecord()` を追加し、`AnnictProvider` に `createRecord` / `updateStatus` mutation を実装した。トリガーは `WatchHistory` が `watched` へ遷移した瞬間 (`WatchHistoryApiModel.update()`、直前が `watched` でない場合のみ) で、`opt-in` の `featureFlags.annictSync` (既定 OFF、既存フラグを利用) が無効なら DB 書き込み・通信とも一切発生しない。引き当ては `RecordedSeriesLink.episodeId` (話数キー) を使い、`Series.annictId` が未確定なら `syobocalTid` 一意確定検索で自動解決を試みる (`AnnictSyncQueueModel.resolveAnnictId`)。送信はキュー化 (`AnnictWatchSync` テーブル、sqlite/mysql マイグレーションあり) して指数バックオフでリトライ (1分→最大6時間、最大8回、`AnnictSyncQueueModel`) し、Annict 障害時も視聴履歴の更新自体は失敗させない (障害分離)。二重送信は `(seriesId, seriesEpisodeId)` の一意制約 + 送信済み行の保持で防止する。手動同期 API `POST /api/series/{seriesId}/metadata/annict-watch` を追加 (`IAnnictSyncApiModel.syncWatchRecords`)
  - **共有静的データの自動取得 (§5.1)**: `ISharedDataFetcher` / `SharedDataFetcher` を追加。`config.metadataSharedDataUrl` から起動時 + `metadataSharedDataUpdateIntervalMs` (既定24時間、0で無効) 間隔でチャンネルマッピング表 JSON を取得し `data/metadataSharedData.json` にキャッシュする。オフライン/取得失敗時は前回キャッシュ→同梱データの順にフォールバックする。`SyobocalChannelMap` は「同梱データ→共有静的データ (自動取得)→`metadataChannelMappingPath` のローカル上書き」の優先順で合成するよう変更 (優先度が最も低いものから上書き)
  - **欠番検出の強化・補完予約提案 (§4.7・S15)**: `SeriesContinuity.analyzeSeriesContinuity()` が `totalEpisodesBySeason` (外部メタデータの放送予定総話数) と放送ペース補正 (録画実績のある局の隣接話数間隔から「現時点までに放送されているはずの話数」を推定) の両方を考慮するよう拡張し、観測済み最大話数だけでなく末尾側の未録画も検出できるようにした (未登録局でのみ視聴している作品の疎らな実績も、実績のある局のペースで補正することで過検出を防ぐ)。新設の `IMissingEpisodeApiModel` (`GET /api/series/{seriesId}/missing-episodes/proposals` / `POST /api/series/{seriesId}/missing-episodes/reserve`) が欠番話数について EPG (Program テーブル) の未来分から再放送候補を検索して提案し、提案から予約を作成すると `SeriesReservationHint` テーブル (sqlite/mysql マイグレーションあり) に `airType: rerun` を事前登録する。録画完了時に `SeriesResolver.resolve()` がこのヒントを最優先で参照し (`reserveId` 経由)、通常のスコアリングより優先して episode/airType を確定させ使用後に削除する (欠番の初回埋め合わせ録画が誤って `first` 扱いになるのを防ぐ)
  - **しょぼいカレンダー XML パーサの堅牢化 (§5.6)**: 正規表現ベースの `SyobocalXml.xmlItems()` を `fast-xml-parser` (DOM ベース) に置き換えた。ネストタグ・同名タグ・属性混在・CDATA を正しく扱え、不正な XML でも例外を投げず空/部分的な結果を返す (新規依存 `fast-xml-parser` を追加、Windows ビルドへの影響なし)
  - **既知の未実装・簡易実装 (継続課題)**: §5.4 の「EPG のイベント名/詳細から話数マスタと突合」は、既存の `parseSeriesInfo` (第n話/#n パース) を EPG 側 (`ProgramSeriesApiModel`) でも話数キーとして使う既存実装に留まり、サブタイトルのみで話数表記が無い番組向けの専用パーサは追加していない。欠番の外部メタデータ総話数はシーズン区分が無い Annict/しょぼいカレンダーの制約上 season 1 にのみ適用する簡易実装。補完予約提案の候補検索は EPG (Program テーブル) ベースのみで、しょぼいカレンダー ProgLookup 側の未来検索には対応していない。`AnnictWatchSync` / `SeriesReservationHint` はいずれも一時的なキュー/ヒントデータのため `DBTools` のバックアップ/リストア対象には含めていない

- S12〜S16 (外部メタデータ連携基盤) のレビュー指摘対応
  - **プロバイダーチェーン (S12)**: `MetadataService.search()` を syobocal → annict の順で直列実行するチェーンに変更。前段 (syobocal) が確定させた `syobocalTid` を後段 (annict) の `MetadataSearchContext.syobocalTid` へ引き継ぐ。チェーン対象外の追加プロバイダーは従来通り並列実行
  - **キャッシュ経由の全外部照会 (S12)**: `search()` も `MetadataProviderCacheDB` を経由するようにし (`provider` カラムに `search:<provider名>` のキーで保存)、UI からの検索連打が API 連打にならないようにした。TTL は `AppSetting` の `metadata.cacheTtlMs` で変更可能 (既定 24h)。期限切れキャッシュは `MetadataService` が 1 時間間隔で `deleteExpired()` を自動実行するようにした (今まで呼び出し元が無く無限に増え続けていた)
  - **ETag 差分取得の下地 (S12)**: `IMetadataProvider.get()` が `{ etag }` オプションを受け取り `METADATA_NOT_MODIFIED` センチネルを返せるように拡張 (304 相当の場合はキャッシュの有効期限のみ延長)。実際の外部 API 側が ETag を返すかはプロバイダー依存
  - **HTTP クライアントの直列化・429 対応 (S12)**: `ProviderHttpClient` をホスト単位のキューで直列化し、同時リクエストが重ならないようにした。`429` は `Retry-After` (秒 / HTTP-date) を尊重してリトライする
  - **しょぼいカレンダー チャンネルマッピング表 (S13)**: `ISyobocalChannelMap` / `SyobocalChannelMap` を追加。同梱データ (`SyobocalChannelMapData.ts`、主要地上波キー局のみのスケルトン) をベースに、config.yml の `metadataChannelMappingPath` で外部 JSON を指定すると上書き/追加できる (オフライン/読み込み失敗時は同梱データにフォールバック)
  - **確定系マッチ・未登録局スキップ (S13)**: `SyobocalProvider.search()` が `context.channelId`/`context.startAt` を使い、ChID + 放送開始時刻 (±5分) から `ProgLookup` で PID→TID を確定するようにした。マッピング表に `syobocal: false` (未登録局) と登録されている局は `ProgLookup` を最初から呼ばずスキップする。`GET /api/metadata/search` に `channelId`/`startAt` クエリを追加しこの経路を呼び出せるようにした
  - **番組表⇄シリーズの事前マッピングバッチ化 (S14)**: `ProgramSeriesApiModel.get()` を DB 書き込みの無い参照専用メソッドに変更 (番組ダイアログを開くだけではレコードが増えなくなった)。マッピングの確定は新設の `precompute(programIds)` が担い、EPG 更新 (`EPGUpdateManageModel.saveProgram` → `PROGRAM_UPDATED` イベント) をトリガーに実行される。判定は録画側の `SeriesResolver`/`scoreCandidate` と同じしきい値 (`settings.series.matchThreshold`、既定 0.8) を再利用し、しきい値未満は確定させない。`GET /api/schedules/series-metrics` を追加し、直近バッチの未マッチ番組率・confidence 分布 (5 バケット) を取得できるようにした。機能フラグ OFF 時は 500 ではなく 404 を返すよう統一
  - **Annict の syobocalTid 一意確定 (S16)**: `AnnictProvider.search()` が `context.syobocalTid` を受け取ると検索件数を増やし、`syobocalTid` が完全一致する作品を文字列一致より優先して一意確定する。`AnnictSyncApiModel.sync()` はシリーズに `syobocalTid` が既にあればそれを検索コンテキストへ渡し、一致した作品のみを採用する (タイトル類似度のしきい値をバイパス)。同期処理も `MetadataService.search()` 経由になったためキャッシュが効くようになった。`AnnictTokenIsNotConfigured` を 500 ではなく 400 で返すよう修正
  - api.yml / api.d.ts に `MetadataProviders` / `MetadataSearchResult(s)` / `ProgramSeriesMetrics` のレスポンススキーマを追加
  - **既知の未実装 (継続課題)**: `IMetadataProvider` のメソッド名は `search`/`get` のまま (`resolveSeries`/`getSeriesInfo`/`listEpisodes`/`pushWatchRecord` への全面改名は見送り、動作的に同等なチェーン/キャッシュ機構のみ追加)。Annict の視聴記録双方向同期 (`pushWatchRecord`、`WatchHistory` 連動) は未着手。GitHub 上の共有静的データ (チャンネルマッピング/エイリアス辞書) のオンライン取得は未実装 (同梱データ + config 上書きのみ)。しょぼいカレンダー XML パーサーの堅牢化 (非正規表現ベース化) は未着手。未登録局向けの話数マスタ突合・遅延放送対応 (§5.4 補完策) は未着手。欠番の「放送予定総話数」ベース検出・補完予約提案 (S15 §4.7) は未着手。すべて opt-in の feature flag (既定 OFF) のままで、無効時は既存動作に影響しない

- シリーズ管理 (S8〜S11) の未確定キュー・マージ/分割・エイリアス・Undo API を追加
  - 未確定キュー: `GET /api/series/pending` (一覧)・`PUT /api/series/pending/{pendingId}` (候補から確定、既存の手動割当ロジックを再利用)・`DELETE /api/series/pending/{pendingId}` (この録画はシリーズ化しない、キューから除外のみで再発防止フラグは持たない)
  - マージ: `POST /api/series/merge` (`fromSeriesId`→`toSeriesId` へリンク・エピソード・エイリアスを統合し `fromSeriesId` を削除)
  - 分割: `POST /api/series/{seriesId}/split` (指定した録画群を新シリーズへ分離。episodeId は分割後クリアされ再解決に委ねる)
  - Undo: `POST /api/series/mappings/{recordedId}/undo` (`SeriesChangeHistory` の直前の未 undo 履歴から復元。履歴が無ければ 404)
  - エイリアス辞書: `GET /api/series/aliases` (`seriesId` で絞り込み可)・`DELETE /api/series/aliases/{aliasId}`
  - 上記追加に伴い `ISeriesPendingApiModel` / `ISeriesMaintenanceApiModel` / `ISeriesAliasApiModel` (+実装) を新規追加し `ModelContainerSetter.ts` に登録
  - `GET /api/series`・`GET /api/series/{seriesId}`・`POST /api/series/{seriesId}/metadata/annict` が機能フラグ無効時に例外を投げっぱなしで 500 になっていたのを他の series 系エンドポイントと同様に 404 へ統一
  - api.yml に `SeriesListItem` / `SeriesDetail` / `SeriesMappingValue` / `SeriesPendingMatchItem` / `MergeSeriesOption` / `SplitSeriesOption` / `SeriesAliasItem` 等のスキーマと `QuerySeriesId` / `PathPendingId` / `PathAliasId` パラメータを追加 (このリポジトリは `paths` を api.yml に静的定義せず express-openapi の fs-routes が各ルートファイルの `apiDoc` から動的に組み立てる方式のため、api.yml 側は components (schemas/parameters) のみを追加する)。同じ型を `api.d.ts` にも追加し、サーバ (`src/model/api/series/*`) とクライアント (`client/src/model/api/series/*`) の重複していたローカル型定義を `apid.*` の re-export に統一
  - クライアント `SeriesApiModel` に `listPending` / `confirmPending` / `rejectPending` / `merge` / `split` / `undoMapping` / `listAliases` / `removeAlias` を追加 (対応する画面 UI は未実装、後続対応が必要)
  - `RecordedDB.deleteOnce()` / `restore()` で `recorded_series_link` / `series_pending_match` の孤立行が残っていた問題を修正 (録画削除・バックアップ復元時にあわせて削除)
  - `DBTools.ts` のバックアップ/リストア対象に `Series` / `SeriesEpisode` / `RecordedSeriesLink` / `SeriesAlias` / `SeriesPendingMatch` / `SeriesChangeHistory` を追加 (`ISeriesDB` に `findAll*`/`restore*` を追加)。旧バックアップファイル (これらのキー未定義) からのリストアも空配列扱いで後方互換
  - **未実装 (残作業)**: 未確定キュー/マージ/分割/Undo/録画一覧シリーズトグルのクライアント UI、機能フラグ OFF 時のナビゲーション導線非表示。既存録画の一括バックフィルバッチは S20 でサーバ側を実装済み (クライアント UI は別ステップ)。詳細はタスク引き継ぎメモを参照

- シリーズ手動オーバーライドを追加（S11）
  - 録画詳細メニューから既存シリーズへの再割当、新規シリーズ作成、シーズン・話数・放送種別修正が可能
  - 手動割当はconfidence=1とmanualLockで自動判定から保護
  - 誤割当の解除にも対応

- シリーズライブラリUIを追加（S10）
  - シリーズ一覧・検索・ページング、シリーズ詳細、録画エピソード一覧を追加
  - 詳細画面は放送局フィルターと再放送表示に対応
  - ナビゲーションからシリーズ画面へ移動可能

- シリーズ自動マッピングエンジンを追加（S9）
  - 正規化タイトル類似度、放送局、しきい値を使って既存シリーズを選択
  - 複数局放送を同一シリーズへ集約し、再放送は既存エピソードへ再利用
  - 録画完了時に自動実行し、手動ロック済み対応は変更しない

- シリーズ管理のデータ基盤を追加（S8）
  - Series / SeriesEpisode / RecordedSeriesLinkと3 DBマイグレーションを追加
  - NFKC、放送枠プレフィックス、再放送記号、話数・サブタイトルを考慮する正規化・話数解析を追加

- 通知設定GUIを実配送へ統合（S7）
  - AppSettingの通知先を録画イベント配送に反映し、暗号化済み署名シークレットを復号して使用
  - Discord/汎用Webhookの配信先編集とテスト通知API・ボタンを追加

- サーバー設定GUIと秘密情報保護を追加（S6）
  - Annict・しょぼいカレンダー・通知・シリーズ設定をWeb UIから編集
  - token/apiKey/secret/passwordをAES-256-GCMで暗号化し、APIでは末尾4文字のみ表示
  - `secretKey`を暗号鍵として使用し、マスク値の再保存では既存暗号文を維持

- DBベースのランタイム設定ストアを追加（S5）
  - `AppSetting`、3 DBマイグレーション、`GET/PUT /api/settings/system`を追加
  - 設定セクションを検証し、`featureFlags.systemSettings`で既定無効化

- ホームダッシュボード集約APIを追加（S4）
  - 録画中・新着録画・今後の予約・競合件数を `GET /api/dashboard` で並列集約
  - 取得件数を1〜50件に制限し、`featureFlags.dashboard` で既定無効化
  - 既存ダッシュボードの予約件数取得を集約APIへ切り替え

- Webhook / Discord 通知基盤を追加（S3）
  - 録画開始・完了・失敗イベントを通知し、イベント単位で配信先を選択
  - Webhook は HMAC-SHA256 署名、Discord は embed 形式
  - 最大5回の指数バックオフ再試行、タイムアウト、機能フラグによる既定無効化

- 録画プレイヤーの視聴履歴 UI を追加（S2）
  - 10 秒間隔・一時停止・終了・画面離脱時に再生位置を保存し、再訪時にレジューム
  - 録画カードへ視聴中/視聴済みバッジと進捗バーを表示
  - 再生画面から視聴済み/未視聴を手動切り替え

- 視聴履歴のサーバー基盤を追加（S1）
  - `WatchHistory` と SQLite / MySQL / PostgreSQL 用マイグレーションを追加
  - `GET/PUT /api/videos/{videoFileId}/playback-position` を追加
  - 90% 視聴済み判定、冪等 upsert、`featureFlags.watchHistory` による既定無効化

- 段階導入向けの開発・テスト基盤を追加（S0）
  - 全新機能を既定無効にする `featureFlags` と型安全な判定ヘルパーを追加
  - UT / ITA / ITB の実行スクリプト、外部 API スタブ、CI ジョブを追加
  - UT は新規ロジックの line coverage 80% をマージゲートに設定
  - ITB は毎日 03:00 JST と手動実行時に動作し、実サービスへ接続しない
  - 詳細は [doc/testing.md](testing.md) を参照

- **Mirakurun/EPGStation**
  - 県境でよくある複数の県外地上波を扱うことができるようにGR/BS/CS/SKYを拡張し、新たにNW1~NW40まで追加
  - Node.js 24 系 (LTS) でのインストール対応 (v18/v20 系のサポートは終了)
  - 各フォーク版MirakurunとEPGStationのビルドが成功するかどうか確認するためのワークフローをActionsに追加
  - タグを push すると GitHub Release を自動作成するワークフローを追加 (`.github/workflows/release.yml`)
    - 3 OS (ubuntu / windows / macOS) × Node 24 でビルドし、`EPGStation-<os>.7z` と `Mirakurun-<os>.7z` をリリースアセットとして添付する (`.git` は除外)
    - リリースノートは `generate_release_notes` で前タグからのコミット/PR から自動生成。タグ名に `rc` / `beta` / `alpha` を含む場合はプレリリース扱い
    - タグ push では `build-validation.yml` は走らないようにした (同一内容のビルドが二重に走るのを防ぐため `tags-ignore` を指定)
  - 各種パッケージの更新
- **Mirakurun**
  - Windowsでlocalhost:40772または、[::1]:40772でアクセスできない問題の修正
  - `0.0.0.0`と`::`をリッスンするオプションの追加
  - EPG取得間隔を放送波ごとに指定できるように変更
  - サービスストリームAPI指定時に物理チャンネルやチューナーグループが異なる場合でも、NIDとSIDが同じ場合はチューナーを利用できるように改変(効率よく選局が可能)
- **EPGStation**
  - 本家EPGStationへのプルリクエストとissueで報告されていたバグ修正のマージ
    - Hotfix: IPTV Simple Client is very slow. l3tnun/EPGStation#614
    - ドロップログ上のパケット数が m2ts ファイル上での実際の数よりも少ない l3tnun/EPGStation#603
    - 定期的に本家の変更に追従
  - dev版Mirakurunとの接続に対応
  - 動画プレイヤーを [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) に置き換え
    - ライブ視聴 (HLS / MPEG-TS 低遅延)・録画再生・録画ストリーミングのすべてが DPlayer 標準 UI で再生される
    - ARIB 字幕・文字スーパーは DPlayer 内蔵の aribb24.js で描画 (従来の手動 PES パース実装は削除)
  - Mirakurun に接続できなくても EPGStation が起動できるように変更
    - 起動時の Mirakurun 疎通確認は有限回リトライで打ち切り、未接続でも Web UI が利用可能
    - チューナー情報はバックグラウンドで 30 秒間隔で再取得し、Mirakurun 復旧時に自動反映
    - 接続状態を返す `GET /api/status` を追加。Web UI は未接続時に画面右上へ警告トースト (`ServerStatusToast.vue`) と解決策 (サービス起動確認・mirakurunPath 確認) を表示 (レイアウトを押し下げないポップアップ形式。旧実装はページ上部に領域を確保するバナー方式だった)
  - 配信用エンコードと録画エンコードが互いのプロセスを kill し合うプリエンプション機構を廃止 (`src/model/service/encode/EncodeProcessManageModel.ts`)
    - 従来は `encodeProcessNum` の上限に達したとき、priority の高い要求が低い要求のプロセスを kill して枠を奪っていた。優先度の設定次第で「エンコード投入により視聴中の配信が落ちる」「配信開始により実行中のエンコード成果が破棄される (出力ファイル削除・再実行なし)」のどちらかが必ず起こる問題があったため、kill による横取りをやめ、枠が無ければ双方とも穏当に失敗する方式に変更
    - 枠不足時は `EncodeProcessManageModelCreateError` を reject するのみとなり、`EncodeManageModel` 側は従来通りこのエラーを枠不足として識別して待ちキューに戻す (録画エンコードは自動リトライされる)
    - 配信開始 API (`/api/streams/live/**`, `/api/streams/recorded/**`) は枠不足時に `500 Internal Server Error` ではなく `503 Service Unavailable` (「同時配信数の上限に達しています」) を返すように変更
    - `ENCODE_PROCESS_PRIORITY` (配信) / `ENCODE_PRIPORITY` (録画エンコード) の値自体は将来のポリシー再導入に備えて変更していないが、現在は比較に使用されない
  - 通常エンコードと視聴用ストリーミングのプロセス枠を分離
    - `encodeProcessNum` は録画ファイルのバックグラウンドエンコード専用、`streamProcessNum` はライブ視聴・録画再生ストリーミング専用の上限として独立
    - バックグラウンドエンコードが上限に達しても視聴開始を妨げず、視聴中ストリームが通常エンコードの枠を消費することもない
  - Mirakurun クライアントの HTTPS 接続対応 (`stuayu/Mirakurun` の `client.ts` に追加された `Client.https` プロパティとセット)
    - `mirakurunPath` に `https://` の URL を指定可能に (WHATWG `URL` でホスト・ポート・パスを解釈し直し、ポート省略時も http/https に応じた既定ポートを正しく補完)
    - API エンドポイントのベースパスを変更できる任意設定 `mirakurunAPIPath` を追加 (省略時 `/api`)
  - ニコニコ実況コメントの弾幕表示機能を追加 (KonomiTV 互換)
    - ライブ視聴では [NX-Jikkyo](https://nx-jikkyo.tsukumijima.net) に旧ニコ生互換 API (視聴セッション → コメントセッションの 2 段階 WebSocket) で接続し、受信コメントを DPlayer の弾幕として描画 (`client/src/util/JikkyoCommentClient.ts`)
    - 録画再生 (`./api/videos/{id}` 再生時) では[ニコニコ実況 過去ログ API](https://jikkyo.tsukumijima.net) から録画時間帯のコメントを取得し、再生位置に同期して描画 (`client/src/util/JikkyoKakologClient.ts`)
    - 実況チャンネルの解決は KonomiTV と同じ NicoJK 由来の対照表 (jikkyo_channels.json) を用いた networkId + serviceId ベース (`client/src/util/JikkyoUtil.ts`)。チャンネル名でのあいまい一致ではないため、県外地上波 (NW1〜NW40) を含む全国の地上波局・BS/CS を正しく解決できる
    - 設定ページに「ニコニコ実況コメントを表示する」スイッチと NX-Jikkyo サーバー URL 設定を追加 (localStorage 保存。サーバー側の config 変更は不要)
  - macOS 26 (Safari 26) 以降でライブ視聴の映像が停止する問題を修正
    - 従来は iOS 判定時のみストリーミング設定を調整していたため、macOS の Safari では mpegts.js (M2TS-LL) が既定のままだった。Safari (iOS / macOS) 判定に変更し、Safari ではライブ視聴の選択肢を HLS のみに絞る (`client/src/model/serverConfig/ServerConfigModel.ts`)
    - Safari のライブ HLS 再生は hls.js を経由せずネイティブ HLS (`<video>` 直接) で行い、自動再生ポリシーに合わせて autoplay を無効化 (`client/src/components/video/LiveHLSVideo.vue`)
    - ライブストリーム API (`m2ts` / `m2tsll` / `mp4` / `webm`) のストリーム停止判定を `req` の close から `res` の close へ変更 (Safari のプリフライト的な接続切断で即座にストリームが停止するのを防止)
  - Vuetify 2 → 4 移行漏れによるアイコンボタンの表示崩れを修正
    - Vuetify 3 以降で `v-btn` の既定 `variant` が `elevated` になったため、`variant` 未指定の `<v-btn icon>` が「白い円 + 影」で描画され、録画済みカード等の上で浮いて見えていた。メニュー/ツールバー用のアイコンボタンに `variant="text"` を明示 (FAB は `elevated` のままが正しいため除外)
    - Vuetify 3 以降でタイポグラフィ用 class が `subtitle-1` / `subtitle-2` → `text-subtitle-1` / `text-subtitle-2` に改名されたため、旧名の class とそれを指す scoped sass セレクタが全く効かなくなっていた。クライアント全体 (17 ファイル) で新名に統一 (`RecordedSmallCard.vue` は小カードのタイトルがメニューボタンの下に潜り込む不具合も解消)
  - 「放映中」ページで放送波タブを押すと画面が真っ白になる不具合を修正 (`client/src/views/OnAir.vue`)
    - Vuetify 2 の `v-tab` は `href="#GR"` 形式でタブ値を指定できたが、Vuetify 3 以降ではこの指定が単なるアンカーリンクとして扱われる。ハッシュ履歴 (`createWebHashHistory`) を使っているため URL が `#/GR` に書き換わり、未定義ルートに遷移して描画が空になっていた。`:value` によるタブ値指定に変更
    - あわせて `v-progress-linear` の進捗指定が Vuetify 3 以降で `value` → `model-value` に変更されていた件を修正 (`OnAirCard.vue` の番組進行度、`EncodeSmallCard.vue` のエンコード進捗が常に 0 表示だった)
  - ライブ HLS の in-memory 配信 (低遅延・ディスク書き込みなし) を追加
    - `stream.live.ts.hls` の cmd が `%streamFileDir%` を含まない場合、fragmented MP4 を標準出力へ書き出すコマンドとみなし、セグメントを `HLSMemoryStoreModel` でメモリ上にのみ保持して配信する (`/streamfiles/` はメモリ→ディスクの順で応答)。tmpfs など OS 依存の仕組みを使わないため Windows でも動作
    - 1 秒固定 GOP + プレイリストウィンドウ 6 で実測遅延 2〜4 秒程度 (従来の hls_time 3 × 17 は 10 秒以上)。in-memory モードは字幕 (ARIB → ID3) 非対応。従来のディスク方式 cmd もそのまま利用可能 (詳細は `doc/streaming-refresh.md`)
  - エンコード設定のチューニングと HEVC 対応例の追加
    - テンプレートのライブ HLS コマンドを VBV 制約 (`-maxrate` / `-bufsize`) + profile/level 指定付きの低遅延 fMP4 版に刷新 (1080p/720p/480p)
    - HEVC (libx265, `-tag:v hvc1`) のコマンド例をコメントで同梱 (`-tag:v hvc1` は Safari / iOS 再生に必須)
  - エンコードコマンドのシェルパイプライン対応 (tsreadex 前処理)
    - cmd に `|` を含む場合はシェル経由 (Windows: cmd.exe / その他: /bin/sh) で実行される (`src/model/service/encode/EncodeProcessManageModel.ts`)
    - `%TSREADEX%` 変数を追加。config の `tsreadex` で実行パスを指定 (省略時は PATH 上の tsreadex)
  - 転居などで放送局情報が失われた過去の録画番組の表示名が壊れる問題を修正
    - 従来は表示用の放送局名を現在の `channel` テーブルから引くだけだったため、受信環境が変わって放送局が無くなると `3231128728` のような channelId がそのまま表示されていた
    - `recorded` に **録画時点の放送局名** (`channelName` / `halfWidthChannelName`) を保持するカラムを追加 (mysql / sqlite 両方のマイグレーションあり)。既存データはマイグレーション時に現在の `channel` テーブルから復元する
    - 録画開始時 (`RecorderModel.createRecorded()`) とアップロード時 (`RecordedManageModel.createNewRecorded()`) に放送局名を保存し、`GET /api/recorded` 等の `RecordedItem.channelName` で返す
    - クライアントは `ChannelNameUtil.getRecordedChannelName()` で「現在の放送局情報 → 録画時点の保存名 → `不明な放送局 (NID: x / SID: y)`」の順に解決する (録画済み一覧・ダッシュボード・視聴画面・エンコード一覧で共通)
    - すでに放送局情報が失われている録画番組向けに復元ツール `npm run recover-channel-name` を追加。`channel` テーブルと録画ファイル名 (`%CHNAME%` / `%HALF_WIDTH_CHNAME%` を含む命名規則) から放送局名を復元する。既定は変更内容の表示のみで、`--apply` 指定時に DB を更新する。録画当時の命名規則が現在の `recordedFormat` と異なる場合は `--format` で指定する
  - Mirakurun のサービス一覧に物理チャンネル情報を持たないサービスが含まれると、それ以降の放送局が DB に登録されない不具合を修正 (`ChannelDB.insert()` の `return` → `continue`)
  - エンコードキューを永続化し、Service プロセスの再起動でキューが消えないように変更
    - 未完了のエンコード情報 (実行中 + 待機中) を `data/encodeQueue.json` に保存する `EncodeQueueStoreModel` を追加。一時ファイルへ書いてから rename するため書き込み途中のファイルが残らない
    - Service プロセス起動時に `EncodeManageModel.restore()` で復元する (`ServiceExecutor.ts`)。実行中だったエンコードはプロセスごと失われているため待機中として積み直し、`encodeId` を引き継いだうえで払い出しカウンタを衝突しない値まで進める
    - 復元完了後に Web API の待ち受けを開始する (復元前に push されると encodeId が衝突するため)
    - 保存タイミングは push / 完了 / キャンセル時。保存に失敗してもエンコード自体は継続する (ログのみ)
  - エンコードが空き枠を残したまま開始されない不具合を修正
    - `ExecutionManagementModel.getExecution()` がタイムアウトした際、実行権待ちキューに自分の要素を残していたため、その要素へ実行権が渡ると誰も `unLockExecution()` を呼べず**ロックが永久に解放されなくなっていた**。以降のエンコード追加・キューチェック・終了処理がすべてタイムアウトし続けるため、「並列実行されるはずのエンコードが動かない」状態になる。タイムアウト時にキューから確実に取り除くよう修正
    - `EncodeManageModel.checkQueue()` は 1 回の呼び出しで 1 件しか起動しないため、同時実行枠が複数空いていても次の終了通知まで次のエンコードが始まらなかった。起動に成功したら続けてキューをチェックするよう変更 (復元時に複数件を一度に起動できるようになる)
    - `checkQueue()` の実行権取得失敗を捕捉し、一定時間後に再チェックするよう変更 (従来は unhandledRejection となりキューが放置されていた)
  - ダッシュボードの録画済みカードの表示崩れを修正
    - Vuetify 3 以降で `v-img` の既定が `cover` から `contain` に変わったため、サムネイルが上下に余白の付いた縮小表示になっていた。`cover` を明示 (`RecordedSmallCard.vue` / `RecordedLargeCard.vue` / `EncodeSmallCard.vue` / `RecordedDetail.vue`)
    - `RecordedSmallCard` の高さが `100px` 固定だったが、Vuetify 3 以降のタイポグラフィでは 4 行分が収まらず説明文が上下で切れてカードからはみ出していた (実測 116px)。`min-height` に変更
  - サムネイルファイルが存在しない場合に `GET /api/thumbnails/{id}` が 500 を返していたのを 404 に修正 (DB には登録があるがファイルが無いケース)
  - DPlayer の画質切替をライブ HLS / 録画再生にも対応 (従来は M2TS-LL のみ)
    - 対象は ライブ HLS (`LiveHLSVideo.vue`)・録画 HLS (`RecordedHLSStreamingVideo.vue`)・録画 mp4/webm ストリーミング (`RecordedStreamingVideo.vue`)。DPlayer 標準の設定メニュー (歯車 → 画質) から `config.yml` の視聴設定 (mode) を切り替えられる
    - HLS は切替時に m3u8 の URL が変わるため、`BaseVideo.setupQualitySwitch()` で `dp.switchQuality` をラップし「ストリームセッション停止 → 新 mode で再作成 → 有効化待ち → URL 差し替え」を非同期で行う。失敗時は notice を出すだけで再生は継続
    - 録画系は現在の再生位置でストリームを作り直すため、DPlayer が行う切替前位置への seek を抑止して先頭から再生する (`resetCurrentTime`)
    - 視聴設定一覧の取得は `client/src/util/StreamQualityUtil.ts` に集約。録画は `videoFile.type` (ts / encoded) に応じた設定を参照する (`IRecordedStreamingVideoState.getVideoFileType()` を追加)
    - ライブの m2ts / mp4 / webm 直接再生 (`NormalVideo.vue`) は切替非対応 (詳細と制限は `doc/streaming-refresh.md`)
  - ストリーミング API に文字列の mode を渡すと 400 になる問題を修正
    - express-openapi が OpenAPI スキーマに従い `req.query` を数値へ型変換するため、文字列前提のパース (`src/model/service/api.ts`) が失敗していた
  - ログファイルを Web UI 上から確認できる機能を追加 (`/logs` ページ)
    - `config/{operator,service,epgUpdater}LogConfig.yml` を解析して実際に出力されているログファイル (Operator/Service/EPGUpdater × system/access/stream/encode、ローテーション済みファイル含む) を列挙する `GET /api/logs`、末尾から指定行数を取得しキーワード絞り込みできる `GET /api/logs/{logFileId}`、ファイルそのものを取得する `GET /api/logs/{logFileId}/download` を追加 (`src/model/api/log/LogApiModel.ts`)
    - クライアントはプロセス→カテゴリ→ファイルのタブ切り替え UI で該当ログを表示し、表示行数・キーワードで絞り込み可能 (`client/src/views/Logs.vue`, `client/src/model/state/log/LogState.ts`)。詳細な出力レベルの設定方法は従来通り [doc/log-manual.md](log-manual.md) を参照
  - 録画再生時のニコニコ実況過去ログ取得処理を改善 (`client/src/util/JikkyoKakologClient.ts`)
    - 従来は取得上限 (3 日分) を超える録画では先頭 3 日分しか取得できなかったが、期間をチャンク分割 (最大 16 回) して順次取得するように変更。最初のチャンクが届いた時点で描画を開始し、残りはバックグラウンドで追加していく
    - DPlayer の弾幕インスタンス生成が完了する前にコメントが届くケースに対応するため、`BaseVideo.ts` に一時キュー (最大 100 件) を追加し、インスタンス生成後にまとめて描画する
  - 依存パッケージを更新 (サーバ / クライアント両方)
    - TypeScript 5.9 → 6.0 系。あわせてクライアントの `tsconfig.json` から TypeScript 7.0 で廃止予定の `baseUrl` を削除し、`paths` を tsconfig 相対 (`./src/*`) に変更
    - ESLint 8 → 10 系へ移行。旧 `.eslintrc.json` を廃止し Flat Config (`eslint.config.mjs`) に移行、`@typescript-eslint/*` は統合パッケージ `typescript-eslint` 8 系に置き換え。lint スクリプトも v9 以降で廃止された `--ext` を削除 (`eslint --fix src/`)
      - ESLint 10 の recommended で追加された `no-useless-assignment` / `preserve-caught-error` は既存コードの記述を維持するため無効化。`@typescript-eslint/no-require-imports` も `swagger-ui-dist` の `require()` を許可するため無効化
    - `eventsource` 2 → 4 系 (default export が廃止されたため `import { EventSource } from 'eventsource'` に変更、`@types/eventsource` は本体同梱の型定義に置き換え)、`js-yaml` 4 → 5 系、`typeorm` 1.0 → 1.1、その他 axios / socket.io / vuetify / vue-router / hls.js / sass / vite 系などをマイナー更新
    - `better-sqlite3` は package.json のみ 13.0.1 表記で lockfile と typeorm の peer (`^12`) に矛盾していたため 12.11.1 に揃えた (npm install が ERESOLVE で失敗する状態だった)
    - 本体が型定義を同梱するようになった `@types/{js-yaml,mkdirp,file-type,socket.io,hls.js,socket.io-client}` を削除
    - `file-type` 16 → 22 系 (ASF パーサの無限ループ脆弱性 GHSA-5v7r-6r5c-r473 の修正が 22 系のみのため)。22 系は ESM 専用だが Node.js 22.12 以降の `require(ESM)` により CommonJS ビルドのままロードできる。API 名変更に伴い `fileType.fromFile()` → `fileTypeFromFile()` に修正 (`src/model/api/video/VideoApiModel.ts`)
    - `uuid` (mirakurun → jsonrpc2-ws 経由の間接依存) を overrides で `^11.1.1` に固定し GHSA-w5hq-g745-h8pq を解消
    - 見送った更新: `url-join` 5 / `inversify` 8 (ESM 専用かつ `require(ESM)` 時に API 互換性の確認が必要)、`vue-facing-decorator` 4 (全クラスコンポーネントに影響)、`typescript` 7 (typescript-eslint 8 の peer が `<6.1.0`)、`aribts` (npm の latest タグが現行より古い)
    - `npm audit` に残る 10 件 (high) は `mirakurun` パッケージ経由の間接依存 (`brace-expansion` / `js-yaml` 4 系) で、いずれも API 非互換な修正版しか存在せず対処不可。EPGStation 側から実行されないコード (redoc / mirakurun 本体) か、静的な glob パターンにしか使われないため実害はない
    - `overrides` の `express-openapi.glob: ^7.0.0` は維持する必要がある。glob 10 以降の `globSync()` は Windows でパス区切りが `\` になり、`fs-routes` が組み立てる API のルートパス (`src/model/service/api/` のディレクトリ構造 = URL パス) が壊れるため
