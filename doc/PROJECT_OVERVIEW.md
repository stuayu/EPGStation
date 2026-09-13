# EPGStation (stuayu フォーク) プロジェクト概要

日本の DTV 録画管理ソフトウェア EPGStation のフォーク版。
上流は [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) で、本フォーク (stuayu 版) は
**Windows 完全対応**・**県外地上波対応 (NW1〜NW40 チャンネル型の追加)**・**Mirakurun dev 版 (stuayu/Mirakurun) との連携** を主軸に拡張している。
フォーク独自の変更点の詳細はすべて [changelog-fork.md](changelog-fork.md) にある。

- 言語/ランタイム: TypeScript / Node.js 24 (CI も 24.x)
- サーバ: Express 5 + express-openapi, TypeORM 1.1 (SQLite / MySQL), inversify (DI), log4js, socket.io
- クライアント: Vue 3 + Vuetify 4 (クラスコンポーネント + `vue-facing-decorator`), inversify による独自 State 管理 (Vuex 不使用)。ビルドは Vite
- 動画再生: [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) に統一 (タグ固定)。HLS は hls.js、低遅延ライブは mpegts.js、ARIB 字幕は DPlayer 内蔵の aribb24.js (`client/src/components/video/`)
- チューナーバックエンド: Mirakurun (`stuayu/Mirakurun` のタグ固定)

## プロセス構成

サムネイルは録画単位で現在の代表VideoFileを選ぶ。`encoded`を優先し、同種なら最新ID、無ければ先頭を使う。Thumbnailには生成元VideoFileのID・サイズ・解析時刻を保存し、VideoFile追加・サイズ更新・メタデータ解析で世代が変わった場合だけ再生成する。

`dist/index.js` (親) を起動すると **2 プロセス構成** で動作する。

```mermaid
flowchart TB
    subgraph OP["Operator (親プロセス) — src/index.ts"]
        RSV["予約管理 / 録画実行"]
        EPGU["EPG 更新 (EPGUpdater を子として spawn)"]
        STORAGE["ストレージ監視 / サムネイル / シリーズ判定"]
    end

    subgraph SV["Service (子プロセス) — src/model/service/ServiceExecutor.ts"]
        API["Web API (express)"]
        STREAM["ストリーミング配信"]
        ENC["エンコード管理"]
        SIO["socket.io 通知"]
    end

    TUNER["Mirakurun / 互換実装"]
    DB[("DB (SQLite / MySQL)")]

    TUNER --> OP
    TUNER --> STREAM
    OP <-- "IPC (src/model/ipc/)" --> SV
    OP --> DB
    SV --> DB
```

**図で全体像を掴みたい場合は [architecture.md](architecture.md)** (受信環境の全体像、録画が生まれるまで、
ストリーミングの経路、EPG のリアルタイム追従を mermaid でまとめてある)。

- 親 → 子は [index.ts](../src/index.ts) の `runService()` が spawn し、落ちたら自動再起動
- **Mirakurun 未接続でも起動する**: 起動時の疎通確認 (`ConnectionCheckModel`) は有限回で打ち切り、30 秒間隔のバックグラウンドリトライで復旧時に自動反映。状態は `GET /api/status` で取れ、Web UI が警告バナーを出す (DB 接続は必須)
- プロセス間通信は `src/model/ipc/` (`IPCServer` = 親, `IPCClient` = 子, 定義は `IPCMessageDefine.ts`)

## ディレクトリ構成

### サーバ (`src/`)

| パス | 役割 |
| --- | --- |
| `src/index.ts` | エントリポイント (Operator)。init → runOperator → runService → cleanup → runEPGUpdater |
| `src/db/entities/` | TypeORM エンティティ |
| `src/db/migrations/{mysql,sqlite}/` | DB 種別ごとのマイグレーション (postgres は空 = 未対応) |
| `src/lib/` `src/util/` | 汎用ライブラリ / 純粋関数ユーティリティ |
| `src/model/ModelContainerSetter.ts` | **DI バインディングの中心。新規クラスは必ずここに登録** |
| `src/model/db/` | TypeORM Repository をラップしたデータアクセス層 (`I*DB.ts` / `*DB.ts`) |
| `src/model/operator/` | 録画エンジン本体: reservation / recording / recorded / rule / storage / thumbnail / externalCommand |
| `src/model/epgUpdater/` | EPG 更新 (Mirakurun イベントストリーム購読 + 定期実行) |
| `src/model/event/` | EventEmitter ベースの内部イベント |
| `src/model/ipc/` | Operator ⇔ Service 間 IPC |
| `src/model/api/` | API ビジネスロジック層 (express 非依存) |
| `src/model/service/api/` | express-openapi ルートハンドラ。**ディレクトリ構造 = URL パス** |
| `src/model/service/encode/` | エンコードプロセス管理 |
| `src/model/service/stream/` | ライブ/録画済み × 通常/HLS のストリーミング |
| `src/model/stream/capability/` | SourceAnalyzer / SourceCapabilities / ClientCapabilities |
| `src/model/stream/preset/` | StreamPresetRegistry (Built-in / Legacy / config 統合) |
| `src/model/stream/resolver/` | PlaybackPolicyResolver (端末・映像特性から再生方式決定) |
| `src/model/stream/builder/` | LiveCommandBuilder / RecordedCommandBuilder |
| `src/model/encoder/` | 起動時の QSVEncC / NVEncC / VCEEncC / ffmpeg HW エンコーダ検出と結果キャッシュ |
| `src/model/service/dataBroadcasting/` | データ放送 (BML) 用 WebSocket サーバ (映像プレイヤーとは別経路) |
| `src/model/series/` `src/model/metadata/` | シリーズ判定と外部辞書 (しょぼいカレンダー / Annict / Wikidata) |
| `src/model/Configuration.ts` | `config/config.yml` の読み込み (fs.watchFile でホットリロード) |

### クライアント (`client/src/`)

| パス | 役割 |
| --- | --- |
| `main.ts` | エントリ。DI コンテナ初期化 → サーバ config 取得 → Vue 生成 |
| `router.ts` | vue-router ルート定義 + スクロール位置復元 (**hash モード**) |
| `views/` `components/` | ページ / 機能別コンポーネント (guide, recorded, reserves, search, series, video, watch など) |
| `model/ModelContainerSetter.ts` | クライアント側 DI 登録 (サーバと同じパターン) |
| `model/api/` | REST API ラッパー (`RepositoryModel` = axios 共通層 + 機能別 `*ApiModel`) |
| `model/state/` | 画面ごとの State クラス (Vuex の代わり) |
| `model/storage/` | localStorage 永続化 |
| `model/socketio/` | socket.io クライアント (`updateStatus` / `updateEncode` / `updateOnAirProgram` / `updateProgram`) |

### API 仕様の共有

- ルートの **`api.yml`** (OpenAPI 3.0.1) が仕様の正。express-openapi がこれを読んでバリデーション/ルーティングする
- ルートの **`api.d.ts`** がサーバ・クライアント共有の型定義 (`import * as apid from '.../api'`)
- 本フォークでは `ChannelType` に `NW1`〜`NW40` (県外地上波) と `BS4K` / `CS4K` を追加済み

## 主要ワークフロー別・変更対象ファイル

| やりたいこと | 触るファイル |
| --- | --- |
| API エンドポイント追加 | `api.yml` → `src/model/service/api/**` → `src/model/api/**` → `ModelContainerSetter.ts` → `api.d.ts` |
| DB スキーマ変更 | `src/db/entities/` → `npm run orm-gen --db=<mysql\|sqlite> --name=<Name>` (**両方**) → `src/model/db/**` |
| 録画・予約ロジック | `src/model/operator/{reservation,recording,rule}/**` |
| EPG 更新 | `src/model/epgUpdater/**` |
| エンコード | `src/model/service/encode/**` |
| ストリーミング | `src/model/service/stream/**` |
| Operator⇔Service 通信追加 | `src/model/ipc/IPCMessageDefine.ts`, `IPCServer.ts`, `IPCClient.ts` |
| 設定項目追加 | `src/model/IConfigFile.ts`, `Configuration.ts` (DEFAULT_VALUE), `src/model/config/ConfigSchema.ts` (単一定義元), 両テンプレート |
| クライアント新ページ | `client/src/views/` → `router.ts` → `model/state/**` → `model/ModelContainerSetter.ts` → ナビゲーション |

## コーディング規約 (両側共通)

- **インターフェース分離**: DI 対象は `IXxx.ts` + `Xxx.ts` (`@injectable()`) のペア。文字列トークン `'IXxx'` で bind し、`container.get<IXxx>('IXxx')` で取る
- **命名**: PascalCase + 役割サフィックス (`~Model`, `~ManageModel`, `~DB`, `~ApiModel`, `~State`, `~Util`)。ファイル名 = クラス名
- **namespace 定数**: クラス定義直後に同名 `namespace` で定義
- **Provider パターン**: 複数インスタンスが要るもの (Recorder, Encoder, Stream) は `toProvider()` でファクトリ注入
- **JSDoc 風の日本語コメント** を public メソッドに付与
- **エラーハンドリング**: サーバ API は try/catch → `api.responseServerError()`。クライアントは try/catch → `ISnackbarState.open()` + `console.error`
- Lint/Format: ESLint (Flat Config) + Prettier。`npm run build-server` に組み込み済み

## ビルド・運用

```bash
npm run all-install   # サーバ + クライアントの依存インストール
npm run build         # Linux/Mac (build-win で Windows)
npm start             # node dist/index.js
npm run backup / restore       # DB バックアップ / リストア
npm run recover-channel-name   # 過去の録画の放送局名を復元 (既定 dry run, --apply で更新)
```

- テストは node:test ベース: `test/ut` (単体、行カバレッジ 80% ゲート) / `test/ita` (実 sqlite) / `test/itb` (HTTP スタブ)。`npm test` = ut + ita、`npm run test:ci` = + itb
- 設定は `config/config.yml` (テンプレートから起動時に自動コピー)。ログ設定は `config/{operator,service,epgUpdater}LogConfig.yml`
- マイグレーションは起動時に自動実行 (`migrationsRun: true`)
- Docker: `Dockerfile.alpine` / `Dockerfile.debian` のマルチステージ
- CI: `build-validation.yml` (3 OS × Node 24)、`docker.yml` (Docker Hub push)、`release.yml` (タグ push で 3 OS 分の 7z を作り GitHub Release 作成)
- データ放送 (BML) は `web-bml` を npm 依存として使うだけで追加のビルド手順は無い

## 主要機能と実装場所

詳細な設計と経緯は `doc/changelog-fork.md` にある。ここは「どこを見ればよいか」の索引。

| 機能 | 入口 | 要点 |
| --- | --- | --- |
| シリーズ自動マッピング | `src/model/series/`, `src/model/metadata/` | 下記「シリーズ判定」参照 |
| TS 解析 | `src/model/recorded/ts/TsInfoAnalyzer.ts`, `src/model/video/VideoFileAnalyzeModel.ts` | 下記「TS 解析」参照 |
| 放送局の系列 | `src/model/channel/BitParser.ts`, `BroadcastAffiliationData.ts` | 正は放送波の BIT (PID `0x0024`)。Mirakurun API では取れないため録画/配信経路から受動収集し `channel_affiliation` へ貯める。未受信の局は同梱データ (networkId 実測 127 局 + 局名 → 系列 129 局) で補い、どちらにも無い局だけ「未分類」。番組表・放映中のグルーピング軸 (地域別 / 系列別) は `/affiliations` のスイッチで切り替え |
| 実況コメント | `client/src/util/Jikkyo*.ts`, `src/model/service/stream/util/BroadcastTimeExtractor.ts` | サーバが TS の TDT/TOT から放送時刻を取り `GET /api/streams` の `broadcastTime` で配る。クライアントは「サーバ遅延 + 再生バッファ + 手動オフセット」だけ描画を遅らせる |
| テーマカラー | `client/src/util/ThemeColorUtil.ts`, `client/src/plugins/vuetify.ts` | Vuetify theme に独自色 `appTheme` を登録し、設定 > 表示 で 8 色から選ぶ (端末ごと・localStorage)。適用先はヘッダー・ナビゲーションドロワー・トグルスイッチ・プログレスバー。**`primary` は差し替えない** (`color="primary"` を明示している全箇所が連動してしまうため)。色の定義はライト用 / ダーク用の 2 値を持ち、`apply()` が両テーマを同時に書き換える |
| 視聴画面 | `client/src/components/watch/WatchLayout.vue` | `position: fixed` の全画面レイアウト。左にアイコンナビ、上に番組情報バー、右に情報パネル (名前付きスロットで差し替え)。視聴中はグローバルナビを畳む。**レイアウトは幅ではなく向きで決まる**: 縦持ち (`orientation: portrait`) の 1024px 以下だけ縦積みにし、横持ちは左右分割のまま (縦積みにすると映像だけで画面が埋まりパネルの高さが 0 になる)。狭い縦持ち (720px 以下) では左のアイコンナビとパネル見出しを畳み、上部と映像を実寸固定にして余りをパネルへ渡す。上部バーの「映像を小さくする」トグル (`isWatchVideoCompact`) は幅ではなく枠の高さだけを下げる (幅を詰めると DPlayer のコントロールが重なる) |
| ストリーミング再生 | `src/model/stream/{capability,preset,resolver,builder}/`, `src/model/service/api/**/playback-options.ts`, `client/src/components/video/quality/`, `client/src/model/state/video/` | SourceAnalyzer → StreamPresetRegistry → PlaybackPolicyResolver → Live/RecordedCommandBuilder。Playback API 2 系統と端末能力対応の画質選択 UI。Playback API は preset id と container 別 mode を返し、DPlayer quality と配信選択ダイアログは同じ profile 一覧を使う。**再生中の画質切替は DPlayer の設定メニューだけが入口** (プレイヤー右上に別の設定アイコンを置かない)。**配信選択ダイアログの画質一覧はダイアログの中でインライン展開する** (別のモーダルを重ねない)。画質 → サーバ mode は `PlaybackProfile.modes[<container>]` で引く (プロファイル配列の添字を mode に流用しない)。DPlayer は `modes` が数値を持つ方式×画質だけを平坦な一覧へ出し、方式ラベルと画質ラベルを `PlaybackLabelUtil.ts` で「標準 (HLS) > 1080p 高画質」のように結合する。方式切替は同一 index の `switchQuality()` に依存せず、`VideoContainer` が対象コンポーネントとストリームを再生成し、録画の再生位置を引き継ぐ。**一覧へ出す方式は `VideoContainer` が prop (`selectablePlaybackContainers`) で各映像コンポーネントへ渡す** — 子コンポーネントはシーク・画質切替のたびに自分で `setPlaybackProfiles()` を呼び直すため、prop で持たせないと呼び直しのたびに一覧が現在の方式 1 つへ縮む (実測: 一覧 11 件 → 1 件)。**`setPlaybackProfiles()` の「現在位置」には quality 配列の添字ではなく実際のサーバ mode を渡す** (`currentMode` 引数)。添字を渡すと選択中の項目を取り違え、M2TS-LL で再生中なのに「MP4 > おまかせ」が選択中と表示される。 **同じ role のプリセットを複数持つ構成 (HEVC 版と AVC 版の M2TS-LL 720p など) では表示名が完全に一致する**ため、`disambiguatePlaybackLabels()` が重複したものだけへ `(HEVC)` / `(H.264)` を足す。判定材料の `PlaybackProfile.videoCodec` は `StreamPreset.output.codec` をそのまま API に載せたもの。**表示ラベルの引き当てキーは `PlaybackProfile.role`** (`auto` / `original` / `2160p-high` / `1080p-high` / `1080p` / `720p` / `data-saver`)。`profile.id` は `live-m2tsll-1080p-avc` のような実プリセット id なので、id で辞書を引くと `auto` 以外は必ず外れる (実際に一言説明とバッジが出ていなかった)。`role` はサーバが `PlaybackApiModel.builtinRole()` で決めて API に載せる。 **「おまかせ」プリセットを返すのはライブだけ**で、録画の配信では `profiles` に `auto` が入らない。`PlaybackOptionsState.getInitialPresetId()` は `auto` が無ければ `recommended.resolvedId` を初期選択にする (`auto` のままだと、一覧のどれも選択されていないのにボタンだけ「おまかせ」と出る)。 **画質の表示ラベル (名前・一言説明・技術詳細・バッジ) は `client/src/util/PlaybackLabelUtil.ts` の 1 か所で決まる** (`getPlaybackLabel()` / `getPlaybackShortLabel()`)。配信選択ダイアログの一覧と DPlayer 設定メニューの両方がここを経由するため、表記を変えるときはここだけを直す。設定 > 再生の既定値 (既定の画質 / 映像補正 / HDR / モバイル回線では画質を下げる) は `playback-options` の `profile` / `preferHdr` / `preferCorrection` / `saveData` として渡り、`PlaybackPolicyResolver` の自動選択に**加減点として**反映する (候補を絞り込まないので設定に合う候補が無くても再生できる)。既存 `stream:` は従来経路を維持。**DPlayer の quality 配列を更新するときは内部 `blob:` URL や空の `video.src` を採用せず、元の配信 URL (`options.video.url`) を優先する。mpegts.js 初期化 URL が空なら fail-fast する** |
| 録画 M2TS-LL の再生成 | `client/src/components/video/RecordedStreamingVideo.vue`, `src/util/MpegTsLifecycleUtil.ts` | レジューム・シークは `switchVideo()` が新 URL を設定する前に、同じ video 要素の旧 MediaSource / SourceBuffer / mpegts.js / ARIB renderer を即時破棄する。URL が同じ同値シークも同じ `reset` 経路で新しい時間軸を作る。別要素を作る画質切替だけ旧 mpegts.js を `canplay` まで保持し、旧 video 専用 renderer は破棄する |
| データ放送 (BML) | `client/src/util/DataBroadcastingManager.ts`, `src/model/service/dataBroadcasting/` | `web-bml` (tsukumijima フォーク) を npm 依存で利用。iframe に隔離せず `BMLBrowser` を直接生成し、**映像要素を BML ブラウザの中へ物理的に移動**して DPlayer に組み込む。録画は `videoFile.startAt + VirtualTimeline の絶対再生位置` を時計の単一基準にし、`seeked` / `canplay` / 画質切替確定時へ即時反映する |
| SNS 投稿 (Bluesky / Misskey) | `src/model/sns/`, `src/model/api/sns/`, `src/model/service/sns/`, `client/src/components/watch/sns/`, `client/src/views/SnsAccounts.vue` | 視聴画面 (ライブ・録画) から投稿できる、KonomiTV の Twitter 実況パネル移植 (Twitter 自体・リプライツリー実況は非移植)。**アカウントはログインユーザーごとに分離** (`sns_account.userId`、匿名時は共有枠)、**認証情報は `ISecretCrypto` で暗号化して DB 保存し、クライアントへは一切返さない**。Bluesky は App Password 方式 (AT Protocol OAuth は LAN 運用で client metadata を公開 HTTPS に置けないため不採用)。**Misskey は MiAuth によるワンクリック連携** — `POST /api/sns/misskey/auth` が発行した `sessionId` をメモリ Map (TTL 10 分、DB 非永続) で持ち、`authUrl` へ `location.href` で遷移 → 承認後 `GET /api/sns/misskey/callback` が 302 で `#/settings/sns?misskey=success\|error` へ戻す。ハッシュタグは `client/src/util/ChannelHashtagData.ts` (局名前方一致表、NW1〜NW40 は通常の地方局名なので `channelType` 分岐不要) + `ProgramHashtagUtil.ts` (番組概要・詳細からの抽出/合成/差し込み) の純粋関数群で組み立て、**自動合成は「番組が切り替わった契機」だけ** (同一番組内での再合成はユーザーが手で消したタグを足し戻すため行わない)。**Misskey の公開範囲・チャンネル・ローカルのみはパネルに UI を持たず**、`SnsAccounts.vue` で設定したアカウントごとの既定値へサーバー側 (`SnsApiModel.postToMisskey()`) がフォールバックする。キャプチャ添付は canvas → JPEG (Bluesky 2MB 上限に収まるよう品質→解像度の順に自動で下げる、`SnsCaptureAttachment.vue`)。**タイムライン・リアクション・カスタム絵文字** (`GET /api/sns/timeline`、`GET /api/sns/misskey/emojis`、`POST`/`DELETE /api/sns/reaction`、`POST /api/sns/renote`) は provider の差を `SnsTimelineNote` / `SnsTimeline` (`api.d.ts`) へ吸収し、変換は `src/model/sns/{Misskey,Bluesky}TimelineConverter.ts` の純粋関数に切り出す。Misskey のカスタム絵文字一覧はインスタンス単位でサーバー側メモリキャッシュ (TTL 1 時間)。**Misskey のリアルタイム TL は `src/model/service/sns/SnsTimelineWebSocketServer.ts` が WebSocket 中継する** — `DataBroadcastingWebSocketServer` と同じ流儀で既存 HTTP サーバーの `upgrade` に `noServer: true` で相乗りし (パス `<subDirectory>/api/sns/ws` 以外には触れない)、`SnsTimelineRelayManageModel` が購読ごとに上流 (`wss://<host>/streaming?i=<token>`) への接続を張り (所有者・provider を検証済み)、届いた note を `SnsTimelineNote` へ変換してから下流へ流す (生の note・トークンは渡さない)。上流切断時は指数バックオフで再接続、購読変更・クライアント切断では上流を必ず閉じる。Bluesky の TL はポーリング (WebSocket 中継なし)。Bluesky の like/repost 取り消しは AT Protocol 上「作成したレコード自身の rkey」が要るため、作成 API の戻り値から抽出した `reactionKey` を一度クライアントへ返し、取り消し時に渡し直してもらう。**Bluesky の repost 取り消し (unrenote) はサーバー API 自体が未実装**のため、クライアント (`SnsTimelinePanel.vue`) は `isRenotedByMe === true` のボタンを disabled にして理由を出すだけに留めている。**投稿パネル (`SnsPostPanel.vue`) の絵文字・MFM 装飾ピッカーは本文 `v-textarea` の実体 `<textarea>` を `$refs` 経由 (`$el.querySelector('textarea')`) で取得し、`selectionStart`/`selectionEnd` を直接操作する** — 絵文字は挿入して直後へカーソルを移すだけ、MFM 装飾は選択範囲があればその文字列を prefix/suffix で包み、無ければ記法を挿入して placeholder を選択状態のまま残す (続けて書き換えられるように)。挿入直後は `$nextTick()` を挟んでから `focus()` + `setSelectionRange()` する (bodyText の書き換えが DOM へ反映されるのを待つ必要があるため)。**リアクション絵文字の URL 解決は 3 段** (`MisskeyTimelineConverter.convertMisskeyNoteToTimelineNote()`): `reactionEmojis['name@host']` (リモート) → `reactionEmojis['name']` (ローカル) → 呼び出し側が渡す `resolveEmojiUrl()` (`MisskeyClient.getEmojis()` のインスタンス単位キャッシュ)。**`reactionEmojis` のキーはリモートだと `name@host`、ローカルだと `name`** で揃っており、短縮名だけで引くとリモート絵文字が必ず外れる。**WebSocket 中継 (`SnsTimelineRelayManageModel`) 経由の note には `reactionEmojis` 自体が無いことがある**ため③のキャッシュ解決が必須。クライアント (`SnsTimelineNoteCard.vue`) 側も `url: null` のときは手元の `emojiMap` で再解決を試みてから諦める。**SNS 投稿パネルは投稿フォームを `v-show` で常時マウントし続ける** (タブ切替中も unmount しない) — `SnsCaptureAttachment` が撮影済みキャプチャを自身の内部状態で持つため、`v-if` で unmount すると未添付のキャプチャが消える。投稿とタイムラインの同時表示 (設定 `snsUseSplitPanelView`、狭い端末では強制的にタブ切替) は新規依存を足さず pointer capture (`setPointerCapture()`) でドラッグ実装。本文のライブプレビュー (設定 `snsEnableComposePreview`) は `MfmText.vue` を使い回し、絵文字一覧の取得は `fetchComposerEmojisIfNeeded()` に一本化してピッカーと二重取得しない。**画像添付は data URL (base64) のまま JSON ボディに乗せて `POST /api/sns/post` へ送る**ため、`express.json()` の既定上限 (100kb) のままだと 1 枚のキャプチャ (最大 1.9MB 相当、base64 で約 2.5MB) すら収まらず必ず 413 Payload Too Large になる (実機で確認した実バグ)。`ServiceServer.JSON_BODY_LIMIT` (既定 20mb) を `express.json({ limit })` へ渡して回避している。**投稿とタイムラインの同時表示は既定 ON** (`snsUseSplitPanelView` の既定値 `true`)。切り替えは設定画面だけでなく `SnsPostPanel.vue` のタブ行にあるアイコンボタン (`mdi-view-split-horizontal` / `mdi-tab`) からも直接行え、狭い端末 (`isMobile`) ではボタンごと隠す (切り替えても見た目が変わらないため)。**Misskey のメディアサーバーは Referer 付きのリクエストをホットリンクとみなして 403 を返す**ため、絵文字・アバター・添付画像は `client/index.html` の `<meta name="referrer" content="no-referrer" />` に依存している (個々の `<img>` / `v-img` の `referrerpolicy` は `src` が先に当たると間に合わないので当てにしない。確認は属性の有無ではなく `naturalWidth > 0` で行う)。**タイムラインの `notes` は 500 件で頭打ちにする** — WebSocket の新着 `unshift()` と無限スクロールの `push()` で無限に伸びるため。間引くのはリストが先頭付近 (`scrollTop <= 40px`) のときだけで、読んでいる最中の古いノートは消さない (間引いたら `cursor` の続きは穴が空くので `hasMore = false` にする) |
| Amatsukaze 連携エンコード | `src/AmatsukazeEncodeTool.ts`, `src/model/amatsukaze/` | `AmatsukazeAddTask` でキューに投入し、`AmatsukazeServer` の TCP RPC (既定 32768) へ接続して自分のタスクだけを追跡。進捗・状態を JSON (`{"type":"progress",...}`) で stdout に出し、既存のエンコード画面 (`EncoderModel`) にそのまま乗せる。設定 (`amatsukaze`) は `editable: 'ymlOnly'` (config.yml 直接編集のみ)。**RPC のメソッド ID (`RPCMethodId`) は Amatsukaze のバージョンで並びが変わる** — 知らない ID を受け取ったサーバはエラーを返さず黙ってソケットを閉じるため、症状は `read ECONNRESET` だけになる。変えるときは 32768 への通信を中継して本物のクライアントのフレームと突き合わせること。**自分のタスクの探索は投入が済んでから** (`markTaskAdded()`) — Amatsukaze のキューは完了しても消えないため、投入前のキューから探すと同じ録画の過去のタスクを掴んで即失敗する。**完了しても `ActualDstPath` は返らない**ことがあり、その場合は `DstPath` (拡張子なしのベース) から `AmatsukazeOutputUtil.findOutputByBase()` で実ファイルを探す (同じベース名で `.ass` / `.chapter.txt` も並ぶ)。**出力ファイルは Amatsukaze が書いた場所をそのまま使う** — Amatsukaze は出力先ディレクトリしか受け付けずファイル名は自分で決めて上書きするため `%OUTPUT%` と食い違うことがあり、移動しようとすると完了直後はまだ掴まれていて `EBUSY` になる。エンコードコマンドが標準出力へ `{"type":"output","path":"..."}` を出すと `EncoderModel` がそのパスを登録する。**コンソール出力は cp932** なので `AmatsukazeTextUtil` を通す (子プロセスの出力はチャンクが文字の途中で切れるため `LineDecoder` で行が揃ってから変換する)。**進捗はコンソール出力の行頭 `[n%]` だけから拾う** — 同じ行の `GPU 21%` や別の行の `CPU: 10.8%` を拾うと値が飛ぶ。進捗行は改行ではなく CR で上書きされるので CR でも行を分ける。**`State.Progress` はキュー全体の進み具合**でタスクの進捗ではないので使わない |
| ログイン認証・権限 | `src/model/auth/` | `auth.enabled` で有効化 (既定 無効)。パスワード (scrypt) と SSO (Google / GitHub)。セッションは HMAC 署名付き HttpOnly Cookie。**最初にサインアップした人が管理者**。`auth.allowAnonymous` が有効でも、未認証で通すのは `GET`/`HEAD`/`OPTIONS` の読み取り系 API だけで、`POST`/`PUT`/`PATCH`/`DELETE` は認証必須。`/api/settings`・`/api/auth/users`・`/api/update`・`/api/logs` は管理者限定。外部プレイヤー用 media token は再生用 API の `GET`/`HEAD` allowlist (動画本体・プレイリスト・IPTV・ライブ/録画ストリーム) にだけ使える |
| 更新通知・ワンクリック更新 | `src/model/update/`, `client/.../UpdatePanel.vue` | GitHub Releases を定期確認。リリース版 (タグ) と開発版 (`main`) を選べる。`git checkout` → `all-install` → ビルド → Operator 終了 (サービス管理に再起動させる)。git clone 環境のみ |
| Windows サービス | `scripts/win-service.js`, `src/util/GitCommand.ts` | `node-windows` で登録。LocalSystem・セッション 0 で動くためユーザーの PATH を参照できず、専用 `Path` と `git config --system safe.directory` を設定する |

### EPG 追従 (EIT[p/f] とリアルタイム同期)

- **未定番組の放送中判定**: `ScheduleApiModel.getBroadcastingSchedule()` は `clampUndefinedDuration()` 後の終了時刻で判定する。暫定3時間の終了時刻を過ぎても、次番組が始まった未定番組を現在番組として返し続けない
- **全件更新の画面通知**: `updateAll()` は前後の「現在 + 次」番組を放送局単位で比較し、変化した局だけ `ON_AIR_PROGRAM_UPDATED` を送る。番組表へは範囲不明 (`channelIds: []`, `startAt/endAt: null`) の `PROGRAM_RANGE_UPDATED` を送り、クライアントに再取得させる。event stream 再接続から60秒以内は全件更新を省略し、定期全件更新は従来どおり実行する
- **event stream 無イベント警告**: 接続後にイベントを1件も受信せず切断した場合、リバースプロキシのバッファリング可能性を warn ログへ出す
- **event stream 障害時の EPG polling**: 無イベント切断または接続失敗が連続すると、`epgPolling` に従いライブ配信中・録画中・録画開始間近の局を優先して `GET /api/programs?networkId=...&serviceId=...` で取得する。既定は60秒・1周期8局。stream復活時に停止し、定期全件更新 (`epgFullRefreshIntervalTime`) は残す
- **EIT[p/f] の集約と永続化**: `LiveStreamBaseModel` はライブTS、`RecorderModel` は録画中TSから present/following を読み、Operator と Service の `EitPresentStore` へ IPC (`notifyEitPresentToOperator` / `notifyEitPresent`) で転送する。`ScheduleApiModel` は鮮度2分以内の present/following を DB の時刻より優先する。受信した番組の時刻は `program` の EIT確定列へ保存し、`ProgramDB` が鮮度内だけ Mirakurun の差分更新・全件更新へ再適用する。鮮度切れ後は Mirakurun へ戻る。DB更新時は予約の番組追従も即時実行する
- **リアルタイム同期**: event stream のイベントを `ProgramUpdatePriority.ts` が `immediate` / `normal` に分類し、`immediate` (番組の消滅・付け替え / 放送時間未定への変更 / `urgentWindowMinutes` 既定 180 分以内に始まる番組) だけを 10 秒 tick を待たず先行して DB へ書く (デバウンス 500ms)。設定は `featureFlags.epgRealtimeSync` と `config.yml` の `epgRealtime`
- **event stream が動いていても定期的に全件突き合わせる**: event stream は差分しか運ばないため、新規番組の `create` が届かないと DB が古いまま残る (再起動でだけ直る)。既存のウォッチドッグは「イベントが来ない」ことしか見ておらず、イベントが届き続けるこのケースを検知できない。`epgFullRefreshIntervalTime` (既定 360 分) ごとに `updateAll()` で取り直す
- **クライアントへの通知は 2 系統**: `updateOnAirProgram` (`channelIds`、EIT[p/f] 相当。視聴画面・放映中一覧) と `updateProgram` (`{ channelIds, startAt, endAt }`、変更のあった時間帯そのもの。番組表)。全体更新 (`updateStatus`) と分けているのは 10 秒周期で飛びうるため
- **予約も同じ通知で追従する**: `updateOnAirReserves()` (その局の現在〜15 分先の programId 予約) と `updateReservesByProgramIds()` (放送が何時間先でも追従)。番組 id が 1000 件を超える更新では id を載せず周期的な全体更新に任せる
- **録画開始ゲート**: 時刻指定予約と programId 予約はともに `getServiceStream` (既定) を録画優先度のリクエスト option で開く。`EitPresentParser` + `RecordingStartGate` が TS 到着 (transport) と EIT[p/f] 境界待ちを分離し、target present の event_id 一致 / target following の start_time 到達を通常開始条件にする。EIT 無しは soft timeout (既定 60 秒)、別 event_id 固着は hard timeout (既定 5 分) で録り逃しを防ぐ。待機中 TS は最大 8 MiB のリングバッファへ保持し、開始時に先に書き出す。設定は `recording.programStreamMode`、`recording.startGate*`、`recording.hardStartGateTimeoutMs`
- **programId 予約の開始待ち**: 既定のサービスストリームでは TS 到着を `firstDataTimeoutMs` で transport 異常として判定し、TS 到着後の EIT 境界待ちとは分離する。target present の event_id 一致、target following の start_time 到達を通常条件とし、EIT 無しは soft 60 秒、別 event_id 固着は hard 5 分で開始する。待機中は最大 8 MiB のリングバッファを使い、同じチャンネルのチューナーを保持する。`programStreamMode: program` の切り戻し経路も維持する
- **録画開始・終了は EIT[p/f] 追従**: service stream は自動終了しないため、対象 present が別 event_id に変化した場合はデバウンス後に終了し、`endAt + timeSpecifiedEndMargin` をハード期限とする。EPG 追従で `endAt` が変われば programId 予約もタイマーを更新する。開始後の一時的 EIT 欠落では終了しない。HTTP 応答、first TS、first EIT、開始/終了理由、priority を info ログへ出し、`isFollowingSchedule` は開始待ち時だけ true とする
- **録画先は空き容量で自動振り替え**: 録画開始前に予想サイズ (番組長 × 放送種別ごとの想定ビットレート + 余裕) を出し、`config.recorded` の順に空きを見て最初に収まる保存先を選ぶ。満杯になり次第順次次へ送り、どこも足りなければ最も空きが大きい所を使う。判定は `RecordedDirCapacity.ts` (純粋関数)、空き取得は `RecordingUtilModel`。設定は `recording.storageFallback*`
- **ログで追える**: EIT[p/f] の受信・予約の再スケジュール・録画側の時刻変更を「変更前 → 変更後」の時刻付き info で出す (整形は `src/util/ProgramTimeLog.ts`)。クライアントへの通知も Operator / Service の両方で接続クライアント数付きの info を出す

### シリーズ判定

外部の作品タイトル辞書が主軸。3 つの辞書をローカル DB へ取り込み、`WorkDictionary` が 1 つのメモリ索引へ統合する。

- 辞書: `SyobocalTitleDictionary` (しょぼいカレンダー、約 8 千件・アニメ) / `AnnictWorkDictionary` (`searchWorks`、約 1.7 万件・アニメ) / `WikidataProgramDictionary` (SPARQL、約 4 万件・**全ジャンル**)。**重複はしょぼいカレンダー TID で結合する** (Annict は `syobocalTid`、Wikidata は `P11648`)
- **判定順**: ①放送予定 (`SyobocalProgramLookup`、放送局 + 放送開始時刻) → ②エイリアス辞書 → ③作品辞書 (タイトル照合) → ④LLM → ⑤類似度スコアリング。**エイリアスより放送予定が優先**、**手動確定 (`manualLock`) だけは放送予定より強い**
- **確度**: `exactStart` (番組の頭から録画) 0.98 / 放送時間帯の包含 0.92 / 系列キー局で代用 (`viaKeyStation`) 0.9。返ってきた作品名が録画タイトルと共通部分を持たないものは `isPlausibleProgramTitle()` で捨てる
- **話数**: タイトルに表記があっても放送予定の `Count` を優先。遅れネットの県域局は `lookupDelayed()` がキー局の放送予定を 28 日遡って対応付ける。総集編・一挙放送 (`isSpecial`) はサブタイトル逆引きの対象外
- **放送種別**: `decideAirType()` が「放送予定が再放送 (`ProgItem.Flag` の bit 8) → `rerun` / キー局を遡って対応付け → `delayed` / それ以外 → `first`」で決める。タイトルに `(再)` があればフラグ付け漏れとみなし `rerun` を残す
- **問い合わせ先の ChID は同梱マップ** (`SyobocalChannelMapData`、124 局)。しょぼいカレンダーの `ChLookup` と実機の networkId / serviceId から起こしているので、**書き換えるときは必ず実データで確認する** (取り違えると別局の番組表を引く)
- **続編は放送時期で選び分ける**: 期表記の無い録画はタイトル照合だと第 1 期に当たるため、基本キーで全期をまとめ放送日時が入る期へ差し替える (再放送では放送日時を渡さない)
- **総話数 (欠番検出)** は `ISeriesTotalEpisodes` が `series.totalEpisodes` → しょぼいカレンダー → Annict の順に解決する
- **実行契機**: 録画完了・アップロード / 取り込み完了 (どちらも `EventSetter`)。手動はバックフィル (`POST /api/series/backfill`、全件 / `onlyUnlinked` / `latest`)、シリーズ単位 (`POST /api/series/reanalyze`)、1 件 (`POST /api/series/analyze/{recordedId}`)。`latest` と `seriesIds` は部分実行なので全件バックフィルの再開カーソルを動かさない
- **判定過程はトレースできる**: `resolve(recording, trace?)` に収集器を渡すと各照会の入力と戻り値を記録する (1 件実行の結果はポップアップ + Operator のログ)
- **表示名は辞書の正式タイトルへ同期する**: `SeriesMetadataFiller.fill()` が `series.title` と引き当てキー `normalizedTitle` を辞書名由来へ揃える (外部 ID あり・手動設定でない・寄せ先が未使用、の 3 条件を満たす場合のみ)。手動で付けた名前 (`titleSource: 'manual'`) は上書きしない
- **誤生成の掃除**: 出所 (`SeriesListItem.origin`) は外部 ID の有無で `dictionary` / `local` を判定。一覧から複数選択して `POST /api/series/merge`、統合先は辞書起点を既定にする。エイリアスの誤学習は設定画面 > シリーズ管理タブから付け替え・削除できる (`source: 'manual'` になり自動学習で上書きされない)
- **しょぼいカレンダーのコメント**は作品コメント (`series.comment`) と放送回コメント (`series_episode.comment`) の 2 種類。作品コメントは全件同期に含めず TID 指定で個別取得する (XML が 9.5MB → 24MB になるため)。表示は Wiki 記法を解析する `SyobocalWiki.ts` + `SyobocalComment.vue` を通す (**`v-html` は使わない**)
- 同期は Operator 起動時 + しょぼいカレンダー 24h / Annict 7d / Wikidata 7d。アイキャッチ画像は Annict 由来で、`SeriesImageModel` がサーバ側でキャッシュして `GET /api/series/{seriesId}/image` で配る (取れない作品は録画サムネイルで代用)

### 録画サムネイル V1

`ThumbnailManageModel` は探索範囲の 5〜95% から候補時刻を生成し、既存 Queue 経由で代表フレームを保存する。同じ `videoFileId` が録画完了・定期掃除などから重複投入された場合、待機中・実行中を通して1件にまとめ、完了・失敗後に再投入可能にする。探索範囲は録画先頭から `thumbnailSearchDuration` 秒 (既定1200秒=20分、0で全編) までで、短い録画は全体を使う。`ThumbnailScorer` は画像評価の差し替え境界で、V1 の `BasicThumbnailScorer` は明るさ・コントラスト・シャープネス・場面変化を加点し、黒画・ぼけを減点する。生成形式は JPEG (既定) / WebP、variant は poster / wide。`Thumbnail` には形式、寸法、動画開始からの相対時刻、スコア、生成時刻を保持する。旧 `filePath` は維持し、既存 API / クライアントから利用できる。保存先は `thumbnailStorageRoot` (未指定時 `thumbnail`)。録画単位の再生成は `POST /api/videos/{recordedId}/thumbnail/regenerate`。

V1.6 では `ThumbnailExtractor` が FFmpeg の RGB24 出力を取得し、`ThumbnailImageAnalyzer` が画像特徴量を計算する。現在は候補時刻ごとに input-side `-ss` で1フレームだけseekし、最大3並列で抽出する。録画区間を連続デコードしないため、長時間TSでも処理量は候補数に比例する。候補単位のtimeoutは120秒で、失敗候補を除外し、全候補失敗・低品質時だけ `thumbnailPosition` を優先する fallback へ戻る。poster 幅は `thumbnailPosterWidth` (既定 1280)、wide は 640。候補ごとの特徴量と score は debug ログ、採用結果は `meta/<recordedId>.json` に保存する。

duration 10 秒未満は中央候補1点とし、候補0件でも既存の thumbnail 生成を継続する。候補時刻の生成は `ThumbnailCandidateGenerator` に統一し、設定した `thumbnailPosition` も duration 不明時・候補1点時に維持する。

エンコード済み動画は `VideoUtil.getChapters()` で埋込チャプターまたは sidecar `*.chapter.txt` を読み、trim後のタイトルが大文字小文字を問わず `CM` で始まる区間と境界前後0.5秒を候補から除外する。全候補がCMなら探索範囲内の非CMチャプター中央で補完し、全チャプターがCM・無効なら画像なしを避けるため通常候補へ戻す。生TSではチャプター解析しない。全件・録画単位の再生成は encoded を優先し、複数ある場合は最大IDを選ぶ。エンコード済みが無ければ従来どおり先頭動画を使う。

### TS 解析

`TsInfoAnalyzer` (`src/model/recorded/ts/`) が `aribts` で PAT / SDT / NIT / PMT / EIT[p/f] / TDT / TOT を解析し `video_file_ts_info` へ保存する。ffprobe と合わせて `VideoFileAnalyzeModel` が入口。

- **既定でファイル中央から読む** (64MB 以上)。先頭には前番組の EIT[p/f] と録画開始直後の壊れた TS が混ざるため
- **`firstTdtAt` は「ファイル先頭の放送時刻」の意味を保つ**。`resolveFileStartAt()` が「先頭を読み直した値」を常に優先し、「中央から実測バイトレートで遡った見積もり」は先頭が読めなかったときの代替としてだけ使う。**見積もりを採否の判断材料にしない** — ファイル全体が一定ビットレートである前提のため、tsreplace 等で再エンコードした VBR のファイルでは数分ずれる (実測: HEVC 出力で 7 分 48 秒、見積もりの方が誤り)。先頭の時刻が中央の時刻より後になる場合だけ、壊れた TDT/TOT とみなして見積もりへ退避する
- **録画対象サービスの決定はまず `expectedServiceId`**: 全サービス TS には本編・サブチャンネル・ワンセグ・データ放送が同居しており、TS だけからは「どれを録画したのか」を仕様上決められない。`TsInfoAnalyzeOption.expectedServiceId` (録画 → channel、取り込みは `option.channelId` から解決) があればそれを必ず採る。**`selectServiceId()` の推定は fallback**: service_type の格 → PID ごとのパケット数 → EIT[p/f] の有無 → service_id 昇順。パケット数の偏りを見るため最低 20000 パケットは読む
- **EIT[p/f] の記述子は STD-B10 どおりに読む**: extended_event_descriptor は `descriptor_number` 順に並べ替えて連結し、末尾の `text_char` も含める (言語違いは混ぜない)。音声の代表は `main_component_flag = 1`。代表映像・代表音声の PID は EIT の `component_tag` と PMT の `stream_identifier_descriptor` (0x52) で引き当て、引けないときだけ stream_type 一致の先頭へ落ちる。**記述子 1 つの decode 失敗で番組情報全体を捨てない**
- **PCR の時間軸は `discontinuity_indicator` で切れる**: TS 連結・ドロップ・エンコーダ再起動で PCR が別の軸になるため、`PcrSample.epoch` が違うサンプル同士で差分を取らない (`correctStartAtByPcr()` は起点と同じ epoch のみ、`calcBytesPerMs()` は epoch ごとの最長区間、`TsPlaybackTimeResolver` は基準 PCR 取得後の不連続で null を返す)
- `video_file.startAt` は TDT/TOT を使うが、**出現位置がファイル先頭から離れていることがある**ため PCR (27MHz) で経過時間を測って補正する (`correctStartAtByPcr()`)
- encoded 動画 (MP4 等) は TS 内時刻を持たないため、`VideoFileAnalyzeModel` が TS の実時刻、同じ録画に紐付く元動画、番組開始時刻−録画開始マージン、ファイル更新日時−動画長の順で `video_file.startAt` を推定する。TS の既存経路と意味は変更しない
- **番組情報の上書きは明示的な再解析のときだけ** (`overwriteProgramInfo`)。取り込み・アップロード時と「未解析のみ」の一括解析は空の項目を補うだけ。**番組名 (`recorded.name`) はどちらでも上書きしない**
- 取り込み時の放送局特定は**ファイル名の推定ではなく network id + service id での厳密な引き当て**を優先する
- 録画の放送局名の表示は `ChannelNameUtil.getRecordedChannelName()`、一覧のタイトル表示は `RecordedUtil.convertRecordedItemToDisplayData()` の 1 箇所で決まる

## 注意点・ハマりどころ

### 環境・ビルド

- **Windows 対応が本フォークの柱**。パス区切り・named pipe を常に考慮する
- package.json の `overrides` にある `express-openapi.glob: ^7.0.0` は外さない。glob 10 以降の `globSync()` は Windows でパス区切りが `\` になり、`fs-routes` の API ルート解決が壊れる
- `mirakurun` 依存は `stuayu/Mirakurun` の**タグで固定**する。ブランチ参照は Mirakurun 側の push で lockfile の integrity が壊れ CI が落ちる
- **リリースタグと package.json のバージョンは形が違う** (`2.14.0-stuayu-260727` と `2.14.0-stuayu`)。素の semver 比較だと自分より新しく見えるため `src/util/VersionUtil.ts` が日付サフィックスを別枠で扱う。現在バージョンの解決は `src/util/CurrentVersion.ts` に集約

### 設定・DB

- **config.yml は「ファイルがベース + DB の差分」**: GUI での変更は `app_setting` の `config` キーに差分として入り、`ConfigOverlay.ts` が重ねて実効値を作る。**yml へは書き戻さない**。差分は各プロセスで **DB 接続直後・モデル構築前**に適用する (多くのモデルがコンストラクタで config を読むため)
- **項目の定義元は `ConfigSchema.ts` の `CONFIG_SCHEMA` に一本化**されている (キー・型・GUI 編集可否・再起動要否・秘密情報フラグ)。追加時は両テンプレートへの記載が必須 (`test/ut/config-schema-template-sync.test.js` が検知)
- `ormconfig.js` (CLI マイグレーション用) は `Configuration.ts` と別に config.yml を読む二重管理
- 対応 DB は sqlite / mysql のみ (postgres のマイグレーションディレクトリは空)
- TypeORM 1.x は criteria が空の `delete()` を禁止しているため、全件削除は `createQueryBuilder().delete()` を使う
- **番組表の全件更新は「残した過去番組」と主キーが衝突しうる**: `epgRetentionTime` で過去の番組を残すと、Mirakurun が終了直後の番組も返し続けるため同じ id を再挿入してしまい、`ER_DUP_ENTRY` で `updateAll()` が丸ごとロールバックされる。`ProgramDB.insert()` が削除の直後に「これから挿入する番組のうち終了済み (`endAt < now`) のもの」の id を消して衝突を防いでいる
- **機能フラグ (`featureFlags`) は opt-out**。未指定は**有効**扱い (`featureFlags: {}` は「全部有効」)
- 秘密情報の暗号化鍵は `data/key/secret.key` に自動生成 (`EPGSTATION_SECRET_KEY_FILE` で上書き可)

### サーバ

- Express 5 は `req.query` がアクセスごとに再パースされる getter のため、`ServiceServer.ts` で一度だけ実体化するミドルウェアを挟んでいる
- ストリーミング API の `req.query` は express-openapi がスキーマに従い数値へ型変換する。`mode` 等を文字列前提で扱わない
- **放送時間未定の番組**: ARIB の `duration = 0xFFFFFF` を Mirakurun は `duration: 1` で返す。そのまま `startAt + duration` にすると開始直後に消えるため、`src/util/ProgramDuration.ts` が暫定の終了時刻 (3 時間) を与え、番組表 API で次の番組の開始時刻まで切り詰める。**番組の時刻を扱うコードは必ずここを通す**
- **Mirakurun 互換実装との差を前提にする**: `recisdb-proxy` のような実装は「チューナ情報の `types` が空」「未運用のサブチャンネル・空きスロットまで全サービスを返す」「`remoteControlKeyId` が無い」「値なしの項目を `undefined` ではなく `null` で返す」。放送波の状態 (`getBroadcastStatus()`) は `types` が空ならチャンネルの `channelType` から補い、Mirakurun からの値は `null` 込みで扱う
- **親と同一内容のサブチャンネルは番組表・放映中から隠す**: 親 (同一 networkId で serviceId 最小) と同時刻・同名の番組しか持たないサブチャンネルを `ScheduleApiModel.createSchedule()` が列から落とす (`isHideDuplicateSubChannel`、既定 有効)。別番組を放送している間は表示される
- **EPG が無い放送局は放映中にだけ出す**: 番組情報を 1 件も持たない放送局は、`getBroadcastingSchedule()` (放映中) では**映像・音声サービスの親サービスだけ**が空の `programs` で返る (視聴はできるため)。**番組表 (`getSchedules()`) では従来どおり落とす**。クライアントは `schedule.programs[0]` を前提にしないこと (`OnAirState` / `OnAirCard.vue` は空を許容済み)
- **放送局の並びはリモコンキー昇順**で、`remoteControlKeyId` が `null` の局は末尾に回る (`ChannelDB` の ORDER BY)。並びがおかしいときは**まずチューナーサーバがキーを返しているかを疑う** (EPGStation 側では補完しない)
- エンコードキューは `data/encodeQueue.json` に永続化され Service 起動時に復元される。キューを変更したら `saveQueue()` の呼び出し漏れに注意
- **エンコードの成否を終了コードだけで判断しない**。外部エンコーダ (Amatsukaze / tsreplace 等) はディスクフルで書き込みに失敗しても終了コード 0 で終わることがある。`EncoderModel.childEndProcessing()` が出力ファイルのサイズ (`MIN_OUTPUT_FILE_SIZE` = 1MiB) も見て失敗扱いにしている。**元ファイルの削除 (`removeOriginal`) はこの判定が失敗を返さないことに依存している**ので、`EncodeManageModel.onFinish()` の分岐を崩さないこと
- `ExecutionManagementModel` (優先度付き排他ロック) の `getExecution()` は 60 秒でタイムアウトする。reject を握り潰すとキュー処理が止まる
- **Annict GraphQL API に `Query.works` は無い** (`searchWorks` のみ)。`Episode.airedAt` も無い。存在しないフィールドが 1 つあるとクエリ全体がエラーになるため introspection で確認してから書く

### クライアント

- **クラスフィールドのコールバックの `this` は Vue インスタンスではない**: `vue-facing-decorator` はフィールドの初期値を data 用の一時インスタンスから集めるため、`private xxxCallback = ((): void => { ... }).bind(this)` の中から `this.watchParam` のようなデータを読むと初期値しか見えない (**メソッドだけが Vue インスタンスへ束縛される**)。**`this.xxxState` もリアクティブなプロキシではなくなる**ので、state を書き換えても再描画が起きない (データは新しいのに画面が古いまま)。**コールバックからメソッドを呼ぶだけでは直らない** — 呼ばれた側の `this` も一時インスタンスのままになる。socket.io の購読は**フィールドを挟まずメソッドをそのまま渡す** (`this.socketIoModel.onUpdateState(this.onUpdateStatus)`)
- **番組表 (`Guide.vue`) のセルは手組み DOM**: `GuideState.createProgramDoms()` が作った DOM を `renderProgramDoms()` で流し込む。データを取り直したら**両方**呼ばないと画面が古いまま (可視判定の `updateVisible()` も `renderProgramDoms()` の末尾で走る)
- **色は Vuetify 3 以降のクラス名で書く**: 背景色は `bg-success` / `bg-grey-darken-3` のように `bg-` が要る (Vuetify 2 の `success` / `grey darken-3` は無効で、**黙って透明になる**)。`v-switch` / `v-progress-linear` は `color` 未指定だと `currentColor` (ほぼ黒) になるため、既定色を `plugins/vuetify.ts` の `defaults` で `appTheme` に寄せてある
- **タイトルバーのタイトルには `.app-bar-title` を付ける**: Vuetify の `.v-toolbar-title` は `flex: 1 1` (basis 0) のため、後ろに置いた `v-spacer` と余った幅を等分してしまう。右にメニューアイコンが 1 つしか無くても画面の半分ほどで ellipsis され、狭い端末では「番組表 08/...」のように日付が読めなくなる (Issue #18)。共通クラス `.app-bar-title` (`client/src/App.vue`、`flex: 0 1 auto`) が必要幅を先に確保する。画面に出すバージョンは `VersionState.getVersionString()` が semver のベースまでに切り詰め、`git describe` そのままの文字列は `getFullVersionString()` (ドロワーのツールチップ) と設定 > 更新で見られる
- **横並びの入力は狭い端末で潰れる**: `.v-input` は既定が `flex: 1 1 auto` なので、`d-flex` に 2 つ並べると入力側だけが縮み、ラベル (「季..」) や選択値 (「M2TS-...」) が読めなくなる。折り返すものは `flex: 1 1 <基準幅>` + `flex-wrap`、縮ませたくないものは `flex: 0 0 auto`。説明 + スイッチの行は説明側の div に `flex: 1 1 auto; min-width: 0` を付ける (付けないとスイッチが画面外へ出る)。`v-date-picker` は固定幅 328px なので `v-menu` / 狭い `v-dialog` では `width: 100%` にする。`v-list-item-title` / `v-card-title` は nowrap + ellipsis なので、項目名・作品名として使うなら `white-space: normal`。入力欄のラベルに説明を書くと省略されるので `hint` へ回す。タイトルバーの menu スロットにアイコンを 3 つ並べると 375px でもタイトルが省略されるため、狭い端末ではケバブメニューへ畳む
- **`v-pagination` は折り返さない**。`total-visible` が大きいまま `show-first-last-page` を付けると狭い端末で前後ページのボタンが画面外に出る。`$vuetify.display.smAndDown` で表示数を減らす (`SeriesPending.vue` が例)。共通の `Pagination.vue` は 500px 以下で `MobilePagination` に切り替わるので、そちらを使えるならそれで良い
- **`DataBroadcastingManager` は `markRaw()` で包む**: BMLBrowser 内部の JS-Interpreter が Vue のプロキシに包まれると壊れる。Vue コンポーネントではなくプレーンクラスに切り出しているのも同じ理由
- **socket.io の接続先を組み立て直さない**: 専用ポート (`socketioPort` / `clientSocketioPort`) の指定が無ければ `GET /api/config` の `useDedicatedSocketIOPort` が `false` になり、クライアントは `location.origin` へそのまま接続する。ここでポートを組み立てるとリバースプロキシ配下 (443 → 8888 など) で必ず接続に失敗する。**接続できていないと画面の自動更新が一切効かなくなる**ので、失敗は `connect_error` (`disconnect` ではない) で拾って知らせること
- **socket.io は複数経路から接続される前提で書く**: 同じサーバーが LAN 直アクセスとプロキシ経由の両方で使われる。サーバは**専用ポートを指定していても Web API と同じ待ち受けでも socket.io を受ける** (プロキシ経由のクライアントは専用ポートに届かないため)。`useDedicatedSocketIOPort` は `api.getAccessPort()` が見たアクセス先ポートと自分の待ち受けポートの一致で**接続ごとに**決まる。クライアントは候補を順に試して切り替えるので、**`getIO()` に直接 `on` してはいけない** (切替で socket が作り直され購読が外れる)。購読は `ISocketIOModel` の `on*` を使う
- **自分の操作の反映をサーバ通知に頼らない**: `RepositoryModel` が POST / PUT / DELETE の成功を `ApiMutationNotifier` へ流し、`SocketIOModel` が `updateStatus` / `updateEncode` と同じ扱いで購読者へ配る。各画面は socket.io の購読だけ書けばよく、削除後の再取得を個別に書く必要はない

### ストリーミング・データ放送

- **再生設計ではコンテナ / Transport と映像特性を分離する**。MPEG-TS だからインターレースとは決めつけない (BS4K は変換後も progressive)。録画ファイルへ 29.97 を固定せず解析済み fps を使い、HEVC Main10/HDR preserve の10bitは `nv12` / `yuv420p` で潰さない。H.264 (8bit) へ再エンコードする配信だけは `-pix_fmt yuv420p` (QSV/VAAPI は `format=nv12`) で明示変換する。HDR→SDR は単なる format 変換で済ませず、トーンマッピングと色域・メタデータ変換を行う
- **デインターレース要否は配信開始時に `src/util/DeinterlaceUtil.ts` で決める**。`StreamProfileManageModel.buildCmd()` は素材未確定のため `%DEINTERLACE%` を自動生成 cmd に残し、`RecordedStreamBaseModel` / `LiveStreamBaseModel` が最終 cmd 生成時に `SourceAnalyzer` の codec / `field_order` / fps / container で置換する。`progressive` は無し、`tt` / `tb` / `bb` / `bt` は有り。`field_order=unknown` でも既知の progressive 系 codec が 59.94fps 以上なら無し、それ以外は MPEG-2 1080i を取りこぼさないため有りに倒す。ライブは progressive と実測できる場合だけ無しにし、放送波の既定は変えない。`SourceAnalyzer` は解析済み録画でも ffprobe の `field_order` / fps を優先し、失敗時または実ファイルパス解決失敗時だけ保存済み DB 情報へ戻す。`video_file` / `video_file_ts_info` に fps / field_order は無いため DB fallback は yadif 有りを維持し、判定材料が欠けた結果はキャッシュしない。実行枝・codec・field_order・fps・yadif 結果を `deinterlace: yadif=...` の info ログへ出す。手書き cmd にプレースホルダが無ければ変更しない

- **HLS は 2 モード**: cmd が `%streamFileDir%` を含まなければ in-memory 配信 (`HLSMemoryStoreModel`、ディスク書き込みなし)、含めば従来のディスク方式。ライブ・録画済みとも同じ判定で、**`encodePresets` が生成する HLS プリセットはどちらも in-memory (fMP4)**。**どちらのモードも ARIB 字幕対応**で、in-memory 側は ID3 を `emsg` box (**version 1 必須**) で運ぶ。in-memory HLS は最初の init / セグメントが15秒来ない場合に、既存の破棄動作を変えず warn ログを出す
- **ライブ HLS の手書き probe 設定**: rigaya 系エンコーダの `--input-analyze` / `--input-probesize` と ffmpeg の `-analyzeduration` / `-probesize` は小さくする。probe が終わるまでエンコーダは出力を始めないため、長いと最初のセグメントが間に合わずストリームが破棄されることがある。**ただしセグメント 0 のまま破棄される事象は probe 設定以外でも起きる** (実測: probe を 1 秒 / 2MB へ縮めても解消しない環境があった)。そのときは `in-memory HLS 初回出力待ち警告` を手掛かりに、cmd を手で実行して各段が出力しているかを確かめる
- **ARIB 字幕 ES の ID3 化は HEVC TS を別扱いにする**: `arib-subtitle-timedmetadater@4.0.10` は映像 codec を見ず、PMT の `stream_identifier_descriptor (0x52)` が `component_tag=0x30〜0x37` または `0x87` の ES だけを字幕として扱う。`0x38〜0x3f` は文字スーパー等の別 ES なので字幕判定に含めない。EPGStation は `stream_type=0x06` の `subtitling_descriptor (0x59)` と従来の component tag を認識する `AribSubtitleTimedMetadataTransform` で直接 ID3 PES/PMT を生成する。`data_group_id` は ARIB STD-B24 の字幕管理・本文に対応する `0x00〜0x08` / `0x20〜0x28` を受理し、PTS の無い PES は時刻を復元できないため破棄する。2026-09-13 の実測 (250 MiB 位置から終端まで) は、HEVC `jikkyo_rose10.ts` (字幕 PID `0x114`) が TS 387 / PES 387 / `0xbd` 387 / PTS有り 387 / ID3 PES 387、MPEG-2 `bi_news.ts` (時系列PMTで字幕 PID `0x130`) が TS 643 / PES 643 / `0xbd` 643 / PTS有り 643 / ID3 PES 641 だった
- **録画 M2TS-LL**: `/api/streams/recorded/{videoFileId}/m2tsll` は `ss` / `mode` / `profile` / `audioTrack` を受け、`ss` はクライアント・API・ストリーム生成直前で0以上の整数秒へ切り捨てる。`RecordedStreamBaseModel` のエンコーダ stdout を `video/mp2t` で直結し、TS は録画中の末尾追従、encoded は `-ss %SS% -i %INPUT%` を使う。TS 入力の m2tsll は入力側で ID3 (PID `0x1FFE`) を map せず、ARIB 字幕 ES を map したエンコーダ stdout へ `AribSubtitleTimedMetadataTransform` を挿入して字幕を運ぶ。tsreadex の有無によらず同じ経路を使う。出力側 TS も HEVC になり得るため、QSVEncC 等で再エンコードした stdout にも同じ変換器を通す
- **録画 m2tsll の mpegts.js は `mediaDataSource.isLive = true`**: 録画ファイルでもサーバは `-readrate` で実時間ペースに絞って供給し続けるため、MMS の `onEndStreaming` で transmuxer を suspend させない。DPlayer の `live` は false のままにして、録画 UI と `ss` での再生成シークを維持する。ライブ m2tsll の経路は変更しない
- **録画データ放送時計**: `src/model/service/dataBroadcasting/DataBroadcastingTime.ts` が `src/util/RecordedJikkyoSync.ts` と同じ時刻計算を使う。`videoFile.startAt` が取得できない場合は推測値を送らず、BML 側の時計を上書きしない。録画ストリーム再生成中の `dummyPlayPosition` も送らない。`DataBroadcastingManager` は `seeked` / `canplay` / `quality_end` で即時送信し、250ms タイマーで通常再生中を追従する
- **録画ファイル入力のペーシング**: 録画 M2TS-LL / MP4 / WebM は `-readrate 1.5 -readrate_initial_burst 45 -readrate_catchup 2` を `-i` 前へ付ける。供給経路を `createReadStream` → `AribSubtitleTimedMetadataTransform` → `ffmpeg.stdin` で再現すると `speed=4.65x` で、readrate は律速ではなかったため前値へ戻した。前方バッファ枯渇の主因はプログレッシブ HEVC 素材へ不要な `yadif` を掛けたエンコード遅延。実測は現状 `yadif` 有り 3.59x、`yadif` 無し 5.28x、`yadif` 無し + `-r 30000/1001` 5.24x、`h264_videotoolbox` 6.95x (HW は今回は採用しない)。録画 M2TS-LL クライアントは lazy load を使わず、`autoCleanupSourceBuffer` で再生済み領域を30秒到達時に15秒遡りまで解放する。ライブは `-re` を含め挙動を変更しない。正常 EOF はレスポンス完了後に回収し、エンコーダ終了を再生中断として扱わない
- **再生停滞時の自動画質 fallback は `VideoContainer` で共通化する**: 「おまかせ」時だけ `waiting`、`currentTime`、`buffered` の実測から停滞を判定する。Resource Timing API または mpegts.js の統計速度が揃えば実効帯域の中央値と API が返す `PlaybackProfile.videoBitrate` を突き合わせ、帯域が十分なのに停滞する場合も配信側エンコード遅延の候補として低負荷方向の適切な段へ直接降格する。サンプル不足時は1段ずつ進め、明示画質・シーク直後・タブ非表示中は変更しない。判定本体は `src/util/PlaybackStallDetector.ts` の純粋関数で、fallback 後は 25 秒クールダウンする
- **M2TS-LL の再接続後復帰は `BaseVideo` が担当する**: 録画のシーク・レジューム・画質切替・音声再接続、およびライブの画質・音声再接続で `initVideo()` 後を監視する。`readyState >= 2` かつ 1 秒以上 currentTime が進まず、`buffered` が存在し、`currentTime` が `buffered.start(0)` より 0.05 秒超手前にあるときだけバッファ先頭へ寄せる。`buffered=[]` の初期化停止やシーク時の重複要求は対象外で、録画シークでは `VideoContainer.applyResumePosition()` と `VirtualTimeline.onDragEnd()` の競合を世代管理で抑止し、`ss` を整数秒へ統一する。初回生成は mpegts.js の `StartupStallJumper` に任せ、正常再生中の巻き戻しと mpegts.js 本体の変更を避ける。これらの MSE 再生成・188 byte 境界対策は別の問題への改善であり、特定の再生位置だけ配信が止まる今回の主因ではない
- **録画 TS の byte seek は毎回絶対位置から始める**: `RecordedStreamBaseModel` は `bitRate * playPosition / 8` から求めた offset を 0〜ファイル長へクランプし、188 byte の TS パケット境界へ切り下げて新しい reader を作る。前回 reader の offset を再利用しないため、後方シークでも入力 TS の境界と PAT/PMT の探索開始を安定させる。info ログの `estimatedOffset` / `readStart` / `fileSize` で計算値と実際の開始位置を追える。encoded mp4 / webm は `-ss %SS% -i %INPUT%` のファイル直接入力で別経路。なお、`ss=366` / `642` / `91` でだけ録画 m2tsll が固着し、`ss=1471` は正常だった症状は、byte 境界や MSE の問題ではなく、入力側 ID3 map による mpegts muxer のインターリーブ待ちだった。手元再現は ID3 map 有り `speed=0.068x`、ID3 map 無し `speed=13.9x`
- **録画 HLS の再開 ready は 1 セグメント、ライブは 2 セグメント**: 録画は先頭固定の通常 HLS なので 1 本目から開始できる。ライブはライブエッジ追従のため 2 本を維持する。クライアントの録画 ready ポーリングは初回即時 + 200ms 間隔 (タイムアウト 60 秒) とする
- **録画実況の時刻とシークを分離しない**: 表示時刻は `videoFile.startAt + VirtualTimeline の絶対再生位置` の1通りだけで計算する (`src/util/RecordedJikkyoSync.ts`)。録画過去ログクライアントは HLS の DPlayer 再生成をまたいで保持し、シーク開始時に `danmaku.clear()`、シーク・画質切替の確定時にコメント index を貼り替える。`dummyPlayPosition` は同期対象から除外し、timeupdate が来ない一時停止中も確定通知で同期する。ライブの遅延補正は録画へ適用しない
- **ライブの Mirakurun 受信は `channelId` 単位で共有する**: `LiveStreamSourceManageModel` が service stream を1本だけ開き、配信ごとに `PassThrough` へ分岐する。分岐後の時刻・BIT・EIT[p/f]・字幕・エンコード Transform は各ライブ配信で独立し、無変換配信も同じ枝を使う。lease の参照が0になったら枝と上流を閉じ、`close` / `end` / `error` でも共有表から除去する。録画・EPG更新の Mirakurun 利用は対象外。PAT/PMT は以後の到着を待ち、無制限リングバッファは持たない
- **M2TS-LL の起動 probe は tsreadex 経由だけ 200KB に制限する**: tsreadex を通す自動生成 cmd は `-analyzeduration 200000 -probesize 200000 -fflags nobuffer` を `-i` より前へ置く。tsreadex 無しは放送波の PAT/PMT 検出を優先して従来の `500000` を維持する。実測は最初の 300KB 出力で 3.9 秒から 3.3 秒へ短縮した (0/100000 は 2.8 秒だが PMT 検出前に走り出す危険があるため不採用)。mpegts.js は stash を有効のまま既定値と同じ `stashInitialSize: 64KiB` を明示固定し、音声・字幕の安定性を保つ。旧プレイヤー保持は1本以下、旧aribb24 rendererは新側生成後に破棄、幅/高さ0のvideoへの字幕入力は抑制、副音声再適用は維持する
- **録画済み HLS はエンコードを再生位置の近くに留める**: 録画ファイルのエンコードは実時間の数倍速で進むため、放置すると再生位置との差が際限なく開く。`HLSMemoryStoreModel.getAheadSegmentNum()` が取得済み seq からの先行量を返し、`RecordedStreamBaseModel` が 150 セグメント (`MAX_AHEAD_SEGMENT_NUM`) を超えたらエンコーダの stdout の読み出しを止める (パイプが詰まりエンコーダ自身がブロックする)。**保持側の破棄基準は「最新から一定件数」ではなく「再生位置 (`lastServedSeq`) から遡って一定数」**: 以前は最新から 180 本を保持窓にしていたが、Safari のネイティブ HLS は再生位置から約 50〜60 秒先までしか取得・バッファしないため、エンコードが先行し続けると保持窓の先頭が再生位置を追い越し (実測: 数分再生すると発生)、**hls.js / Safari が `synchronizeToLiveEdge()` でエンコード最新位置へ強制シークして再生位置が飛ぶ**不具合があった (録画済みのプレイリストもエンコード中は `#EXT-X-ENDLIST` が無いため live 扱いになる)。現在は再生位置から約 120 秒分 (`RECORDED_KEEP_BEHIND_SEGMENT_NUM`) を切り捨てずに保持する (再生位置が未判明の起動直後だけ件数ベース (180 本) で暫定的に守る。メモリ上限の安全弁として 400 本 (`RECORDED_MAX_SEGMENT_NUM`) を超えたら未取得でも破棄する)。**エンコードの抑制は止めっぱなしにしない**: 完全に止めるとプレイリストの更新も止まり、ブロッキングプレイリスト要求 (`?_HLS_msn=`) の応答が変わってから次を取りに来るプレイヤー (iOS Safari 等) がセグメントを取得しなくなる → 先行量の基準 (`lastServedSeq`) も進まない → 永久に再開しない、というデッドロックになる (再生が止まったまま戻らない)。そのため抑制は比例制御で行い、停止時間 = (先行量 - 150) × 100ms (上限 5 秒 = `pauseTime`) だけ止めて**先行量が減っていなくても必ず再開する**。**再開判定のループの上限は固定の 5 秒ではなく、その都度計算した `pauseTime` を使う** — 固定値にすると、超過がわずかで `pauseTime` が短く計算された場合でも常に上限の 5 秒まで停止が引き延ばされてしまう (先行量は視聴の実時間経過でしか減らないため、短い `pauseTime` 内では再開しきい値まで下がりきらず、ループが際限なく延長され続けていた)。**一定時間ごとの粗い ON/OFF にもしない** — 停止中もエンコーダはパイプバッファへ書き込み続け、再開時に一気に流れ込むため配信がバーストと空白の繰り返しになり、再生がとびとびになる。**エンコーダの正常終了 (exit code 0) はストリームを止めない**: 録画のエンコードは実時間より速く進むため、再生が終わるより先に必ずエンコーダが終了する。終了をそのままストリーム停止に結び付けると `HLSMemoryStoreModel.delete()` でまだプレイヤーが取得していない末尾のセグメントまで失われる (実測: 9.8 分の録画で 363 秒地点まで再生できていたのに、エンコーダ終了と同時にストアごと削除され再生が戻らなくなった)。正常終了時は `HLSMemoryStoreModel.markEnded()` を呼んでプレイリストへ `#EXT-X-ENDLIST` を付けるだけに留め (待機中のブロッキング要求もここで解決する)、実際の停止はクライアント切断や keep タイマー切れによる通常の `stop()` に任せる。異常終了 (0 以外の exit code) は従来どおり即座に停止する
- **in-memory HLS は LL-HLS (`#EXT-X-PART`)**: パート = fMP4 フラグメント = GOP (既定 0.5 秒)、2 パートで 1 秒セグメント。**ただし録画済み配信と複数音声レンディションは LL-HLS にしない** (Safari のネイティブ HLS がライブ端のパートを先取りしてエンコード抑制を壊す / 音声レンディションを先頭までしか取得しないため。実測値は `doc/streaming-refresh.md`)。ブロッキングプレイリスト要求 (`_HLS_msn` / `_HLS_part`) と `#EXT-X-PRELOAD-HINT` の先行要求は、該当パートが生成されるまでレスポンスを保留する。**`emsg` (字幕) はセグメントではなくパート先頭に置く** (パートが単独配信されるため)
- **音声トラックの切り替えは cmd のプレースホルダで行う**: `%DUALMONOMODE%` (`-dual_mono_mode main|sub`)、`%AUDIOMAP%` (`-map 0:v:0 -map 0:a:<n>`)、`%AUDIOSELECTMAP%` (既に映像 map がある cmd 用の `-map 0:a:<n>`)、`%AUDIOFILTER%` (pan / volume を 1 本の `-af` へ統合)。**二か国語放送のデュアルモノラルは `-map` では選べない** (1 つのステレオ ES の左右に主音声・副音声が入っているため)。TS 入力は `-dual_mono_mode sub`、encoded 入力の副音声は `pan=stereo|c0=c1|c1=c1`。主音声へ pan は掛けない。ファイル直接再生は `audioTracks` が複数ならブラウザ実装、1 本のステレオ AAC なら Web Audio API で副音声を切り替える。Web Audio 非対応時は UI を出さず再生を維持する
- **音声フィルタのシェル判定**: encoded の `pan` は `|` を含むため、フィルタ全体を引用してもシェルパイプとして扱わない。`ProcessUtil.hasShellPipeline()` は引用符外の `|` だけを検出し、`EncodeProcessManageModel` は spawn 直前の置換済みコマンドを実行・記録する。これを外すと ffmpeg が分割実行され、encoded の `audioTrack=sub` が 0 バイトになる
- **`config.tsreadex` を設定すると、生成 cmd の前段へ tsreadex が入る** (`-x 18 -n -1 -a 13 -b 7 -c 5 -u 5`)。二か国語放送はデュアルモノラルで送られ、番組が切り替わると PMT の音声構成そのものが変わるが、tsreadex を通せば以降は「映像 + 音声 2 本 (PID 0x0110 / 0x0111 固定)」になる。**同梱していないため、設定が無い環境では従来どおり挟まない**。**`-b 5` (無音 AAC を挿入) にしないこと** — EPG が二か国語と言っていても実際の AAC がデュアルモノラルでない放送局があり、副音声が完全な無音になる (実測: `-b 5` で -91.0dB、`-b 7` で主音声と同じ -28.4dB)。**tsreadex を通すと副音声は `-dual_mono_mode sub` では選べない** (分離済みなので `-map 0:a:1`)。`AudioTrackUtil` が置換前の cmd に `%TSREADEX%` があるかで切り替える。**`audioTrack=all`** は tsreadex 正規化済みのときだけ主音声・副音声の両方の ES (`-map 0:a:0 -map 0:a:1`) を同時に配信する (m2tsll でクライアントが再接続無しに切り替えるための経路。下記「再接続無しの音声切替」参照)。tsreadex 無しで `all` が来た場合は `main` と同じ扱いにする。tsreadex 正規化済みで `audioTrack` 未指定なら index 0 (主音声 ES) を明示的に選ぶ (未指定のまま空にすると m2tsll では何も map されず配信が始まらない)
- **m2tsll は `-map 0` / `-map "0:d?"` / 入力側 `-map "0:i:0x1ffe?"` を使わない**: 相乗りサービスの文字スーパー (PID 0x138、PTS の無い `bin_data`/`private_stream_2`) や疎な ID3 timed metadata を map すると mpegts muxer がインターリーブ待ちで数フレームだけ書いて固着する。`StreamProfileManageModel.buildCmd()` は tsreadex の有無によらず `-map 0:v:0 %AUDIOSELECTMAP% -map "0:s?" -c:s copy` を生成し、TS 入力では字幕 ID3 を `streamProcess.stdout` へ `AribSubtitleTimedMetadataTransform` で付け直す。**ディスク HLS は同じ対処をしていない** (`%AUDIOMAP% -map "0:s?" -map "0:d?"` のまま。同じ問題を抱えうるが実測で確認できておらず現状維持)
- **M2TS-LL の位置依存固着の実測**: ID3 map 有りは `speed=0.068x` / `fps=1.6`、ID3 map 無しは `speed=13.9x`。`ss=366` / `642` / `91` は壊れ、`ss=1471` は正常だった。MSE 再生成と 188 byte 境界は別の改善であり、この症状の原因ではない
- **cmd を生成する側にも必ずプレースホルダを埋める**: `cmd` を省略した配信プリセットは `StreamProfileManageModel.buildCmd()` が、新経路の builder は `LiveCommandBuilder` / `RecordedCommandBuilder` がコマンドを組み立てる。ここで `-dual_mono_mode main` を直書きすると `AudioTrackUtil.replacePlaceholders()` の置換対象が無くなり、**API が `audioTrack` を受け取っていても黙って主音声のまま再生される** (実際にそうなっていた)。**`-map 0` で全 ES を通す container (hls) には `%AUDIOMAP%` を入れない** — `-map 0` と併記すると ES が二重に出力されるため、`%DUALMONOMODE%` + `%AUDIOFILTER%` だけにする

#### 再接続無しの音声切替 (tsreadex 経由の m2tsll)

`PlaybackProfile.embeddedAudioSwitch` (コンテナ別 boolean) が「主音声・副音声を再接続無しで同時配信できるか」を示す。`PlaybackApiModel` が該当コンテナの実プロファイルの cmd (`IStreamPresetRegistry.resolveProfileCmd()` で取得) を見て、`%TSREADEX%` と `%AUDIOMAP%` または `%AUDIOSELECTMAP%` を両方含みコンテナが m2tsll のときだけ true にする。hls は in-memory HLS (cmd が `%streamFileDir%` を含まない) なら true になる (`Fmp4Packager` が音声 trak 2 本を検出して映像・音声を別レンディションへ分解し、`#EXT-X-MEDIA` 付きのマスタープレイリストを返す。**マスターの `CODECS` は必須**で、無いと Safari のネイティブ HLS が再生できない。**複数音声のレンディションは LL-HLS にしない** — パート付きだと Safari が音声を先頭セグメントまでしか取得せず再生が止まる)。HLS のクライアント側切替は hls.js の `hls.audioTrack` / ネイティブ HLS の `video.audioTracks[i].enabled` (`client/src/util/HlsAudioTrackUtil.ts`)。クライアント (`LiveMpegTsVideo.vue` / `RecordedStreamingVideo.vue`) は `embeddedAudioSwitch.m2tsll === true` のとき `audioTrack=all` で開き、音声切替を `dp.plugins.mpegts.switchPrimaryAudio()`/`switchSecondaryAudio()` の直接呼び出しで行う (再接続しない)。画質切替で mpegts.js インスタンスが作り直された直後 (新インスタンスは常に主音声から始まる) は副音声の選択を再適用する。false/不明なら `switchQuality()` へ委譲せず、m2tsll は `audioTrack` 付き URL を `switchVideo()` へ渡し、HLS は `stop()` → `start()` → URL 差し替えで現在位置から再接続する
- **ライブで選べる音声トラックは番組情報から求める**: 録画済みは実ファイルを ffprobe で見られる (`GET /api/videos/{videoFileId}/audio-tracks`) が、ライブには実ファイルが無い。`GET /api/channels/{channelId}/audio-tracks` が放送中番組の音声 ES 一覧 (Mirakurun の `audios[]`) から組み立てる。デュアルモノラル (`componentType` = 0x02) の ES 1 本は主音声・副音声の 2 件へ展開し、通常のステレオ放送は空配列を返して切替 UI を出さない。番組情報が取れない放送局のため、クライアントは**一覧が空のときだけ**主音声・副音声の 2 択へ落とす
- **録画音声一覧は有限 probe で取得する**: `VideoUtil.getAudioTracks()` は完了録画・録画中とも `-analyzeduration 10000000 -probesize 20000000` (10秒 / 20MB) を使い、ファイル全体を走査しない。`-count_frames` は音声 ES 一覧に不要な全フレーム計数なので指定しない。本番の主音声から21.7秒遅れて始まる ES を2本とも検出できる実測を基準にした。`getDetailedInfo()` とライブ配信の低遅延 probe 値は変更しない。音声 ES の数値指定は optional map と主音声 map を併記し、指定 ES が区間に無い場合も映像+主音声で配信を継続する。トラック一覧は probe 範囲内の候補なのでシークごとの再取得は行わない
- **ライブ音声一覧は EIT[p/f] 切替へ追従する**: `updateOnAirProgram` を受けて `/channels/{channelId}/audio-tracks` を再取得する。番組切替で選択中の ES が消えた場合は主音声へ戻し、m2tsll は `switchPrimaryAudio()`、HLS / 非同時配信は主音声でストリームを再生成する。取得成功で空配列になった場合は通常ステレオとして切替 UI を隠し、取得失敗時だけ fallback の主音声・副音声を表示する
- **`audios[]` は捨てずに `program.audios` (JSON) へ保存する**: `audioSamplingRate` / `audioComponentType` は主音声だけの互換用で、二か国語かどうかや副音声の言語はそこから分からない。読み出しは `src/util/ProgramAudioUtil.ts`、トラック一覧の組み立ては `src/util/ProgramAudioTrackUtil.ts`
- **`mpegts.js` は tsukumijima フォークをコミット SHA で固定する** (`client/package.json`)。本家 npm 版には Safari 向けの実運用修正が入っていない (音声タイムスタンプのギャップを埋める処理が Safari だけ無効化されており、タイムラインが縮んで **Safari 26.5 以降で再生が止まる**。ライブの `MediaSource.duration` も `Infinity` にならない)。ブランチ参照にすると lockfile の integrity が壊れて CI が落ちる
- **チャプターは DB に持たず要求のたびに ffprobe で読む** (`GET /api/videos/{videoFileId}/chapters`)。DPlayer に `highlight` を渡せるのは生成時だけなので、プレイヤーを作る前に取得すること。**マーカーの位置決めは DPlayer に任せない** — DPlayer は `durationchange` のたびに `time / video.duration` で位置を計算し直すため、ストリーミング再生ではエンコードが進むたびにマーカーが動く。`VirtualTimeline` が `options.highlight` を取り上げて自分で描く。時刻表示・シークバーも同じく `VirtualTimeline` が独占し、DPlayer の `initVideo()` 後に描画 listener を再接続して標準描画より後へ固定する。**MPEG-TS はチャプターを埋め込めない**ので、ffprobe が 0 件のときは動画の横の `<動画ファイル名>.chapter.txt` (simple chapter format) を読む (`ChapterFileUtil`)。Amatsukaze の tsreplace 出力 (`*.hevc.ts`) はこの経路になる
- **rigaya 系 (QSVEncC / NVEncC / VCEEncC) の cmd には `--repeat-headers` を必ず付ける**。既定では VPS/SPS/PPS をストリーム先頭にしか出さないため、後段 ffmpeg が `-c:v copy` で mp4 (fMP4) へ remux するときに extradata を作れず `Could not write header (incorrect codec parameters ?)` で**1 フレームも書けない**。in-memory HLS はセグメントを 1 本も作れず、クライアントは有効化を待ち続けて **video 要素すら作られない** (本番のライブ HLS がこの状態だった)。実測 (QSVEncC 8.16): 無しだと ffprobe で `Video: hevc, none` (解像度・pix_fmt 不明) / fMP4 出力 exit=-22・0 byte、付けると `hevc (Main), yuv420p, 1920x1080, 29.97fps` と読めて 646 frames・7.7MB を出力。**mpegts 出力 (m2ts / m2tsll) は `-c:v copy` がそのまま通るため症状が出ず、HLS と MP4 だけが壊れる**
- **HEVC を配信するなら fMP4 + `hvc1` タグが必須**: iOS / Safari は MPEG-TS セグメントの HEVC を再生できず、`hev1` タグでも映像が出ない。rigaya 系 (QSVEncC 等) はエンコーダ側でタグを指定できないため、後段 ffmpeg の `-c:v copy -tag:v hvc1` で付ける。プロファイルは Main・8bit 4:2:0 に固定する
- **rigaya 系エンコーダ (QSVEncC / NVEncC / VCEEncC) で録画ファイルを直接読む cmd (`--seek %SS% -i %INPUT%`) には `--avsync forcecfr --fps 30000/1001` が必須**。rigaya 系はファイル先頭付近のタイムスタンプからフレームレートを推定するが、録画 TS (特に tsreplace 出力) は先頭が不揃いなため推定を外し (実測: 59.94fps を 31.75fps と誤検出)、映像だけが遅れて音ズレする (60 秒で 7.2 秒)。`forcecfr` が入力 PTS どおりの CFR に揃え、`--fps` が出力レートを固定して LL-HLS のパート長を一定に保つ。パイプ入力 (ライブ・録画中の TS) は放送 TS がそのまま流れるので対象外 (`EncodePresets.FILE_INPUT_SYNC_OPTIONS`)
- エンコード cmd に `|` を含むとシェル経由で実行される (tsreadex 前処理用)。`%TSREADEX%` は config の `tsreadex` で置換。**シェル経由の cmd へパスを埋め込むときは必ず `ProcessUtil.replaceShellPlaceholder()` を通す** — 録画ファイル名には空白・括弧が普通に入るため、素の文字列置換だとシェルがそこでコマンドを分割し、エンコーダが起動直後に落ちる (画面には「再生が始まらない」としか出ない)
- **データ放送の WebSocket は socket.io と同じサーバの `upgrade` イベントに `noServer: true` で相乗りする**。パスが `<subDirectory>/api/dataBroadcasting/ws` と一致しない socket には絶対に触れない (触ると socket.io のハンドシェイクが壊れる)
