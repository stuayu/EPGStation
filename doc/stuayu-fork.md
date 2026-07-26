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
