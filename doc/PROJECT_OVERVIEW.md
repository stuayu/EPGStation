# EPGStation (stuayu フォーク) プロジェクト概要

日本の DTV 録画管理ソフトウェア EPGStation のフォーク版。
上流は [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) で、本フォーク (stuayu 版) は
**Windows 完全対応**・**県外地上波対応 (NW1〜NW40 チャンネル型の追加)**・**Mirakurun dev 版 (stuayu/Mirakurun) との連携** を主軸に拡張している。
フォーク独自の変更点は [stuayu-fork.md](stuayu-fork.md) を参照。

- 言語/ランタイム: TypeScript / Node.js 24 LTSのみ (CIでは24.xを検証)
- サーバ: Express 5 + express-openapi, TypeORM 1.1 (SQLite / MySQL), inversify (DI), log4js, socket.io
- クライアント: Vue 3 + Vuetify 4 (クラスコンポーネント + デコレータ, `vue-facing-decorator`), inversify による独自 State 管理 (Vuex 不使用)。ビルドは Vite
- 動画再生: [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) に統一 (GitHub タグ固定)。HLS は hls.js、低遅延ライブは mpegts.js、ARIB 字幕は DPlayer 内蔵の aribb24.js を利用 (`client/src/components/video/`)。ニコニコ実況コメントの弾幕表示に対応 (NX-Jikkyo / 過去ログ API, `client/src/util/Jikkyo*.ts`)
- チューナーバックエンド: Mirakurun (`stuayu/Mirakurun` の stuayu-main 系コミットに固定)

## プロセス構成

`dist/index.js` (親) を起動すると **2 プロセス構成** で動作する。

```
┌──────────────────────────────┐    child_process.spawn + IPC
│ Operator (親プロセス)          │◄──────────────────────────────┐
│  - 予約管理 / 録画実行          │                                │
│  - EPG 更新 (EPGUpdater)      │   ┌──────────────────────────┐ │
│  - ストレージ監視              │   │ Service (子プロセス)       │─┘
│  src/index.ts                 │   │  - Web API (express)      │
└──────────────┬───────────────┘   │  - ストリーミング配信       │
               │                    │  - エンコード管理           │
        Mirakurun / DB              │  - socket.io 通知          │
                                    │  src/model/service/        │
                                    │      ServiceExecutor.ts    │
                                    └──────────────────────────┘
```

- 親 → 子は [index.ts](../src/index.ts) の `runService()` が spawn し、落ちたら自動再起動
- **Mirakurun 未接続でも起動する**: 起動時の疎通確認 (`ConnectionCheckModel`) は有限回で打ち切り、チューナー情報は 30 秒間隔のバックグラウンドリトライで復旧時に自動反映。接続状態は `GET /api/status` で取得でき、Web UI が警告バナーを表示する (DB 接続は従来通り必須)
- プロセス間通信は `src/model/ipc/` (`IPCServer` = 親側, `IPCClient` = 子側, メッセージ定義は `IPCMessageDefine.ts`)

## ディレクトリ構成

### サーバ (`src/`)

| パス                                  | 役割                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | エントリポイント (Operator)。init → runOperator → runService → cleanup → runEPGUpdater                                            |
| `src/@types/`                         | グローバル型定義                                                                                                                  |
| `src/db/entities/`                    | TypeORM エンティティ (Channel, Program, Recorded, Reserve, Rule, Thumbnail, VideoFile など)                                       |
| `src/db/migrations/{mysql,sqlite}/`   | DB 種別ごとのマイグレーション (postgres は空 = 実質未対応)                                                                        |
| `src/lib/` `src/util/`                | 汎用ライブラリ / 純粋関数ユーティリティ                                                                                           |
| `src/model/ModelContainerSetter.ts`   | **DI バインディングの中心 (約 400 行)。新規クラスは必ずここに登録**                                                               |
| `src/model/db/`                       | TypeORM Repository をラップしたデータアクセス層 (`I*DB.ts` / `*DB.ts`)                                                            |
| `src/model/operator/`                 | 録画エンジン本体: reservation / recording / recorded / rule / storage / thumbnail / externalCommand                               |
| `src/model/epgUpdater/`               | EPG 更新 (Mirakurun イベントストリーム購読 + 定期実行)                                                                            |
| `src/model/event/`                    | EventEmitter ベースの内部イベント                                                                                                 |
| `src/model/ipc/`                      | Operator ⇔ Service 間 IPC                                                                                                         |
| `src/model/api/`                      | API ビジネスロジック層 (express 非依存)                                                                                           |
| `src/model/service/api/`              | express-openapi ルートハンドラ。**ディレクトリ構造 = URL パス** (例: `api/reserves/{reserveId}.ts` → `/api/reserves/{reserveId}`) |
| `src/model/service/encode/`           | エンコードプロセス管理                                                                                                            |
| `src/model/service/stream/`           | ライブ/録画済み × 通常/HLS のストリーミング                                                                                       |
| `src/model/service/dataBroadcasting/` | データ放送 (BML) 用 WebSocket サーバ (`web-bml/worker` の `decodeTS` で TS を解析し配信、映像プレイヤーとは別経路)                |
| `src/model/Configuration.ts`          | `config/config.yml` の読み込み (fs.watchFile によるホットリロード付き)                                                            |

### クライアント (`client/src/`)

| パス                            | 役割                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `main.ts`                       | エントリ。DI コンテナ初期化 → サーバ config 取得 → Vue 生成                  |
| `router.ts`                     | vue-router ルート定義 (全 19 ページ) + スクロール位置復元                    |
| `views/`                        | ページコンポーネント                                                         |
| `components/`                   | 機能別の再利用コンポーネント (guide, recorded, reserves, search, video, watch など) |
| `model/ModelContainerSetter.ts` | クライアント側 DI 登録 (サーバと同じパターン)                                |
| `model/api/`                    | REST API ラッパー (`RepositoryModel` = axios 共通層 + 機能別 `*ApiModel`)    |
| `model/state/`                  | 画面ごとの State クラス (Vuex の代わり)                                      |
| `model/storage/`                | localStorage 永続化                                                          |
| `model/socketio/`               | socket.io クライアント (`updateStatus` / `updateEncode` イベント購読)        |

### API 仕様の共有

- ルートの **`api.yml`** (OpenAPI 3.0.1) が API 仕様の正。express-openapi がこれを読み込んでバリデーション/ルーティングする
- ルートの **`api.d.ts`** がサーバ・クライアント共有の型定義 (`import * as apid from '.../api'` で参照)
- 本フォークでは `ChannelType` に `NW1`〜`NW40` を追加済み

## 主要ワークフロー別・変更対象ファイル

| やりたいこと              | 触るファイル                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API エンドポイント追加    | `api.yml` → `src/model/service/api/**` → `src/model/api/**` → `ModelContainerSetter.ts` → `api.d.ts`                       |
| DB スキーマ変更           | `src/db/entities/` → `npm run orm-gen --db=<mysql\|sqlite> --name=<Name>` (**mysql/sqlite 両方**) → `src/model/db/**`      |
| 録画・予約ロジック        | `src/model/operator/{reservation,recording,rule}/**`                                                                       |
| EPG 更新                  | `src/model/epgUpdater/**`                                                                                                  |
| エンコード                | `src/model/service/encode/**`                                                                                              |
| ストリーミング            | `src/model/service/stream/**`                                                                                              |
| Operator⇔Service 通信追加 | `src/model/ipc/IPCMessageDefine.ts`, `IPCServer.ts`, `IPCClient.ts`                                                        |
| 設定項目追加              | `src/model/IConfigFile.ts`, `Configuration.ts` (DEFAULT_VALUE), `config/config.yml.template` (+ `config-win.yml.template`) |
| クライアント新ページ      | `client/src/views/` → `router.ts` → `model/state/**` → `model/ModelContainerSetter.ts` → ナビゲーション                    |

## コーディング規約 (両側共通)

- **インターフェース分離**: DI 対象は必ず `IXxx.ts` (インターフェース) + `Xxx.ts` (実装, `@injectable()`) のペア。文字列トークン `'IXxx'` でバインドし、利用側は `container.get<IXxx>('IXxx')`
- **命名**: PascalCase + 役割サフィックス (`~Model`, `~ManageModel`, `~DB`, `~ApiModel`, `~State`, `~Util`)。ファイル名 = クラス名
- **namespace 定数**: クラス定義直後に同名 `namespace Xxx { export const ... }` で定数を定義
- **Provider パターン**: 複数インスタンスが必要なもの (Recorder, Encoder, Stream) は `toProvider()` でファクトリ注入
- **JSDoc 風の日本語コメント** を public メソッドに付与
- **エラーハンドリング**: サーバ API は try/catch → `api.responseServerError()`。クライアントは try/catch → `ISnackbarState.open()` + `console.error`
- Lint/Format: ESLint (Flat Config: `eslint.config.mjs`) + Prettier。`npm run build-server` に lint/format が組み込まれている

## ビルド・運用

```bash
npm run all-install   # サーバ + クライアントの依存インストール
npm run build         # Linux/Mac (build-win で Windows)
npm start             # node dist/index.js
npm run backup / restore   # DB バックアップ / リストア
npm run recover-channel-name   # 過去の録画番組の放送局名を復元 (既定は dry run, --apply で更新)
```

- テストは node:test ベースで整備済み: `test/ut` (単体、行カバレッジ 80% のゲート付き) / `test/ita` (実 sqlite でのマイグレーション等) / `test/itb` (ローカル HTTP スタブサーバを使う通信系)。`npm test` = ut + ita、`npm run test:ci` = ut + ita + itb
- データ放送 (BML) 機能は `web-bml` (tsukumijima/web-bml) を npm 依存として使うだけで、追加のビルド手順は無い。`npm run all-install` → `npm run build` (従来通り `build-server && build-client`) だけで済む
- 設定: `config/config.yml` (テンプレートから起動時自動コピー)。ログ設定は `config/{operator,service,epgUpdater}LogConfig.yml`
- マイグレーションは起動時に自動実行 (`migrationsRun: true`)
- Docker: `Dockerfile.alpine` (node:24-alpine3.24 ベース) / `Dockerfile.debian` (node:24-trixie ベース) のマルチステージ
- CI: `.github/workflows/build-validation.yml` (3 OS × Node 24 のビルド検証、Mirakurun `stuayu-main` ブランチと組み合わせ。タグ push では走らない)、`docker.yml` (マルチアーチイメージの Docker Hub push)、`release.yml` (タグ push で 3 OS 分の 7z を作り GitHub Release を自動作成)

## 注意点・ハマりどころ

- **視聴画面 (ライブ / 録画) は全画面レイアウト**: `client/src/components/watch/` の `WatchLayout` が `position: fixed` で画面全体を覆い、左にアイコンナビゲーション・上に番組情報バー・右に情報パネル (番組情報 / チャンネル / 次の話 / コメント) を置く。視聴中はグローバルナビゲーション (drawer) を畳み、離れるときに元へ戻す。右パネルの中身は名前付きスロットで差し込むため、画面ごとにタブの組み合わせを変えられる。実況コメントの一覧は `BaseVideo` が弾幕を描くタイミングで上げる `jikkyoComment` イベントを `VideoContainer` 経由で受け取る (遅延補正後なので弾幕と表示が揃う)。詳細は `doc/stuayu-fork.md`
- package.json の `overrides` にある `express-openapi.glob: ^7.0.0` は外さないこと。glob 10 以降の `globSync()` は Windows でパス区切りが `\` になり、`fs-routes` 経由の API ルート解決 (ディレクトリ構造 = URL パス) が壊れる
- **データ放送 (BML) は `web-bml` (tsukumijima/web-bml、otya128/web-bml のフォーク) を npm 依存として利用する**。ビルド済み `dist/` をコミットしたフォークなので `npm install` だけで使え、映像は引き続き EPGStation 側の DPlayer が持つ (web-bml 本体のエンコード機能・koa サーバは使わない)
- **BML ブラウザは iframe に隔離せず `BMLBrowser` を直接生成し、映像要素を BML ブラウザの中へ物理的に移動して DPlayer に組み込む**。内部は closed な Shadow DOM のため本体 CSS とは衝突しない。`BMLBrowser` を保持するクラス (`client/src/util/DataBroadcastingManager.ts`) は **Vue のリアクティブ監視 (Proxy) に入れると内部の JS-Interpreter が壊れる**ため、必ず `markRaw()` で包んで保持する
- **データ放送の WebSocket (`DataBroadcastingWebSocketServer.ts`) は socket.io と同じ http/https サーバの `upgrade` イベントに `noServer: true` で相乗りする**。パスが `<subDirectory>/api/dataBroadcasting/ws` と一致しないリクエストの socket には絶対に触れないこと。触ると同居している socket.io のハンドシェイクが壊れる
- `ormconfig.js` (CLI マイグレーション用) は `Configuration.ts` とは別に `config/config.yml` を独自に読む二重管理になっている
- postgres のマイグレーションディレクトリは空。対応 DB は sqlite / mysql のみ
- `mirakurun` 依存はフォーク版 (`stuayu/Mirakurun`) のコミット固定。ブランチ tarball 参照にすると Mirakurun 側の push で lockfile の integrity が壊れ CI が落ちるため、必ずコミット SHA の URL で固定する
- Windows 対応が本フォークの柱。サーバ側変更時は Windows での動作 (パス区切り、named pipe など) を常に考慮すること
- Express 5 では `req.query` がアクセスごとに再パースされる getter になったため、`ServiceServer.ts` でリクエスト受信時に一度だけ実体化するミドルウェアを挟んでいる
- TypeORM 1.x では criteria が空の `delete()` が禁止されているため、全件削除は `createQueryBuilder().delete()` を使う (既存コードは対応済み)
- **ライブ実況の遅延補正**: ライブ配信は `BroadcastTimeExtractor` (`src/model/service/stream/util/`) が TS の TDT / TOT を読んで放送時刻を保持し、`GET /api/streams` の `broadcastTime` で配る。クライアント (`BaseVideo.ts`) は「サーバ遅延 + 再生バッファ + 手動オフセット」の分だけ実況コメントの描画を遅らせる
- **放送局の系列 (日テレ系・TBS 系…)**: 判定の正は放送波の **BIT (PID `0x0024`)** に載る系列識別 (`affiliation_id`)。Mirakurun の API では取れないため、**録画ファイルの TS 解析とライブ視聴の配信経路からの受動収集**で集め (`src/model/channel/BitParser.ts` / `BitCollectTransform.ts`)、`channel_affiliation` テーブルへ貯める。ただし BIT はその局を実際に受信するまで集まらないので、**まだ受信していない局は公知の系列を集めた同梱データ (`BroadcastAffiliationData.ts`) で補う**。同梱データは「networkId の実測値 127 局」と「放送局名 → 系列の全国データ 129 局 (Wikipedia の各ニュースネットワーク + 全国独立放送協議会の加盟局一覧が出典)」の 2 段構えで、実測値に無い地域の局も局名から引ける (局名の照合は長い正式名称から。「大分放送」と「大分朝日放送」のような包含関係があるため) (BIT を受信済みの局は常に BIT が優先)。同梱データにも無い局 (ケーブル・コミュニティ局) だけが「独立系」ではなく**「未分類」**になる。番組表・放映中のグルーピング軸 (地域別 / 系列別) は**系列局ページ (`/affiliations`) のスイッチ**で切り替える (既定 地域別、設定は両画面共通)。系列で絞った番組表 (`/guide?affiliation=`) の放送局はキー局が先頭で、以降は都道府県コード順 (`client/src/util/AffiliationChannelSort.ts`)。詳細は `doc/stuayu-fork.md`
- **しょぼいカレンダーのコメントは Wiki 記法**: `*見出し` / `-箇条書き` / `:項目:内容` / `[[ラベル URL]]` / `!注記` で書かれている。表示は `client/src/util/SyobocalWiki.ts` (解析) + `client/src/components/series/SyobocalComment.vue` (描画) を通す。**`v-html` は使わない** (構造を組み立ててテンプレートで描画する)。コメントを表示する画面を増やすときはこのコンポーネントを使うこと
- **シリーズの外部辞書タグ**: しょぼいカレンダー / Annict / **Wikidata** へのリンク付きタグは `client/src/components/series/SeriesExternalLinks.vue` に集約している (`SeriesDetail.externalIds` の `syobocalTid` / `annictId` / `wikidataQid`)
- **録画ファイルの TS 解析**: 取り込み・アップロードしたファイルは `TsInfoAnalyzer` (`src/model/recorded/ts/`) が `aribts` で PAT / SDT / NIT / PMT / EIT[p/f] / TDT / TOT を解析し、放送局・番組・ストリーム構成を `video_file_ts_info` テーブルへ保存する。**EIT[p/f] からは概要・詳細・ジャンル 3 組に加えて映像音声情報 (component_descriptor / audio_component_descriptor) も取り出し**、EPGStation で録画した番組と同じ項目を埋める。API で録画情報だけ先に作って後から動画を足した場合は `VideoFileAnalyzeModel.applyProgramInfo()` が**空の項目だけ**補完する (既存値は上書きしない)。取り込み時の放送局特定は**ファイル名の推定ではなく network id + service id での厳密な引き当て**を優先する。ffprobe 解析と合わせて `VideoFileAnalyzeModel` (`src/model/video/`) が入口になり、Operator (取り込み時) と Service (API 経由) の双方から使う。`video_file.startAt` (ファイル先頭に対応する実時刻) は TDT / TOT が取れればそれを使う (実況コメントの時刻合わせに効く)。**TDT/TOT はファイル先頭からある程度離れた位置で初めて出現することがある**ため、そのまま採用すると誤差が乗る。PCR (27MHz) でファイル先頭からの実経過時間を測り、その分を差し引いて補正する (`TsInfoAnalyzer.correctStartAtByPcr()`、詳細は `doc/stuayu-fork.md`)
- エンコードキューは `data/encodeQueue.json` に永続化され、Service プロセス起動時に `EncodeManageModel.restore()` で復元される (Web API の待ち受け開始はこの復元後)。キューを変更するコードを追加したら保存 (`saveQueue()`) の呼び出し漏れに注意
- `ExecutionManagementModel` は優先度付きの排他ロック。`getExecution()` の Promise は 60 秒でタイムアウトするため、呼び出し側は必ず reject を処理する (放置するとキュー処理が止まる)
- **機能フラグ (`featureFlags`) は opt-out**。未指定の機能は**有効**として扱われ、止めたいものだけ `config.yml` に `false` を書く (`src/model/FeatureFlags.ts` / `client/src/util/FeatureFlags.ts`)。`featureFlags: {}` は「全部無効」ではなく「全部有効」を意味する
- シリーズ自動マッピングは **外部の作品タイトル辞書が主軸**。**3 つの辞書**をローカル DB へ取り込み、`WorkDictionary` (`src/model/series/`) が 1 つのメモリ索引に統合して引く
    - `SyobocalTitleDictionary` (しょぼいカレンダー、約 8 千件・アニメ専門) / `AnnictWorkDictionary` (Annict `searchWorks`、約 1.7 万件・アニメ専門) — Annict 側が持つ `syobocalTid` で厳密に結合する
    - `WikidataProgramDictionary` (Wikidata SPARQL、約 4 万件・**全ジャンル**) — ドラマ・バラエティ・情報番組・ローカル局番組を担当。Wikidata の `P11648` (しょぼいカレンダーのシリーズ ID) でアニメ辞書と厳密に結合し、重複を作らない。一般番組は短く一般的なタイトルが多いため、**厳密キー (`strictProgramKey`) の完全一致のみ**で引く (含有・前方一致には参加させない)
    - `SeriesResolver` はこの統合辞書を使い、録画タイトル同士の類似度判定は辞書で引けなかった場合のフォールバック。さらに `seriesLlm` を設定すると LLM が装飾を剥がした番組名で辞書を引き直す
    - **しょぼいカレンダーのコメントも取り込む**: 作品コメント (`TitleItem.Comment`、シリーズ単位の長文) と放送回コメント (`ProgItem.ProgComment`、エピソード単位の短いメモ)。作品コメントは全件同期に含めず、シリーズになっている作品だけ TID 指定で個別に引く。**1 作品 1 リクエストかつ しょぼいカレンダーは Cloudflare のレート制限 (429) が厳しいため 1 回では取り切れない**ので、`SeriesMetadataFiller` は 1 回 300 件までにして繰り越しがあれば 10 分後に自動で続きを実行する。`ProviderHttpClient` は `cal.syoboi.jp` へのアクセス間隔を 1500ms に取り、429 を受けたら間隔を自動で広げる。どちらもシリーズ詳細画面から編集・削除でき、手動で触ったものは `commentSource: 'manual'` になり自動同期で上書きされない
    - **話数は「放送局 + 放送開始時刻」でも確定できる**: `SyobocalProgramLookup` (`src/model/metadata/syobocal/`) がしょぼいカレンダーの放送予定 (`ProgLookup`) を引き、`TID` / 通し話数 / サブタイトルを返す。タイトルの表記に依存しないため、話数表記もサブタイトルも無い録画で効く。**タイトルに話数表記があっても必ず引き、`TID` が一致すれば放送予定の話数を優先する**。取得は放送日 1 日分をまとめて行いキャッシュするので、局・日ごとに 1 回で済む。**問い合わせ先の ChID は同梱マップ (`SyobocalChannelMapData`、地上波 + BS + CS の 124 局) で決まる。ChID は しょぼいカレンダーの `ChLookup`、networkId / serviceId は実機の値から起こしているので、番号を書き換えるときは必ず実データで確認すること** (取り違えると別局の番組表を引く)。しょぼいカレンダー未登録の地方局は系列のキー局の放送予定で代用するが、遅れ放送で別番組を指しうるため作品の確定には使わない。**遅れネットの県域局は `lookupDelayed()` が別に効く**: 作品 (TID) が確定していればキー局の放送予定をその作品に絞って 28 日遡り、録画時刻より前で最も近い放送をその回とみなして話数・サブタイトルを確定する (`airType` は `delayed`)。総集編・一挙放送 (`SeriesParseResult.isSpecial`) は通し話数を持たないためサブタイトル逆引きの対象外
    - 同期は Operator 起動時 + しょぼいカレンダー 24 時間 / Annict 7 日 / Wikidata 7 日間隔 (`featureFlags.metadataProviders` + 各連携が有効な場合のみ。Annict はアクセストークン必須、Wikidata は不要で既定 ON)。詳細は `doc/stuayu-fork.md`
    - **続編 (第 2 期など) は放送時期で選び分ける**: 局が期の表記を送出しない録画 (「株式会社マジルミエ[字]」など) はタイトル照合だと常に第 1 期に当たるため、`WorkDictionary` が期表記を落とした基本キーで同じ作品の全期をまとめ、録画の放送日時が入る期へ差し替える。再放送 (`airType === 'rerun'`) では放送日時を渡さない (第 1 期の再放送が第 2 期の期間に入るため)
    - **判定の実行は「全件 / 未シリーズ化のみ / 直近 N 件 / 1 件だけ」から選べる**: バックフィル (`POST /api/series/backfill`) の `onlyUnlinked` は DB 側で `recorded_series_link` に無い録画だけに絞り、`latest` は直近 N 件だけを対象にする (どちらもサーバー設定 > シリーズ管理タブから指定。`latest` 指定時は部分実行として扱い、全件バックフィルの再開カーソルを書き換えない)。録画 1 件だけの実行は `POST /api/series/analyze/{recordedId}` (録画詳細画面のボタン)
    - **自動実行の契機は「録画完了」と「アップロード / 取り込み完了」の 2 つ**。どちらも `EventSetter` が `ISeriesResolver.resolve()` を呼ぶ。アップロード側は TS 解析 (放送局・番組名・開始時刻の確定) が済んだ後に発行される `addUploadedVideoFile` イベントを受けるため、しょぼいカレンダーの放送予定照会をそのまま使える
    - **判定過程はトレースできる**: `ISeriesResolver.resolve(recording, trace?)` に収集器を渡すと、各照会 (放送予定・エイリアス・作品辞書・LLM・類似度) の入力と戻り値を記録する。1 件実行の結果はポップアップに表示され、同じ内容が Operator のログにも出る。外部への HTTP は `ProviderHttpClient` がステータス・所要時間・サイズ・リトライをログに残す
- **config.yml は「ファイルがベース + DB の差分」**: GUI で変更した値は `app_setting` の `config` キーに差分として入り、`Configuration` が読み込み時に重ねて実効値を作る (`src/model/config/ConfigOverlay.ts`)。**yml へは書き戻さない** (コメント破壊と watchFile ループの回避)。`dbtype` / `mysql` / `sqlite` / `postgres` / `auth` は編集対象外。差分は各プロセスで **DB 接続直後・モデル構築前**に適用する必要がある (多くのモデルがコンストラクタで config を読むため)
- **EIT[p/f] の即時反映**: 現在放送中/次の番組の更新は socket.io の `updateOnAirProgram` (更新のあった放送局 id 付き) で配り、視聴画面・放送中一覧・番組表がその場で追随する。全体更新 (`updateStatus`) とは別イベントなのは 10 秒周期で飛びうるため。**同じイベントで予約も追従する**: `EventSetter` が `ReservationManageModel.updateOnAirReserves()` を呼び、その放送局の「現在時刻〜15 分先に重なる programId 予約」だけを再スケジュールする (`epgUpdateIntervalTime` 周期の `updateAll` を待つと緊急地震速報や延長・繰り上げの反映が最大 10 分遅れ、録画開始に間に合わないため)
- **EPG 追従はログで追える**: EIT[p/f] の受信 (`EPGUpdateManageModel.saveProgram()`)、予約の再スケジュール (`ReservationManageModel.update()`)、録画側の時刻変更 (`RecorderModel.update()`) をいずれも **変更前 → 変更後の時刻付きで info** に出す。整形は `src/util/ProgramTimeLog.ts` に集約。予約側は `reserve.isTimeUndefined` (終了時刻未定) / `reserve.isFollowingSchedule` (前番組延長で開始待ち) を持ち、予約一覧とダッシュボードで赤字・チップ表示する
- **録画開始ゲート**: 時刻指定予約はチャンネルストリームを使うため予定時刻から即データが流れる。前番組が「放送時間未定」で延長していると前番組を録ってしまうため、`EitPresentParser` + `RecordingStartGate` (`src/model/operator/recording/`) が EIT[p/f] present を読み、**予約した番組が始まるまで録画ファイルを作らない** (待機中のデータは捨てる)。EIT を読めないまま既定 60 秒を過ぎたら録り逃さないよう開始する。設定は `config.yml` の `recording.startGate*`
- **録画開始は EIT[p/f] 追従**: programId 予約は Mirakurun の program stream (eventId + parseEIT) を使い、対象イベントが present になるまでデータが流れない。前番組の延長で開始が遅れている間は「まだ始まっていない」だけなので、`RecordingRetryPolicy` がチューナー異常とは別枠で既定 3 時間まで待つ (`config.yml` の `recording` で調整可)。録画終了もストリームの終了 (別イベントが present になって Mirakurun が閉じる) で判定するため、programId 予約では `reserve.endAt` を停止に使わない
- **放送時間未定の番組**: ARIB の `duration = 0xFFFFFF` を Mirakurun は `duration: 1` で返す。そのまま `startAt + duration` を終了時刻にすると開始直後に消えるため、`src/util/ProgramDuration.ts` が暫定の終了時刻 (3 時間) を与え、番組表 API で次の番組の開始時刻まで切り詰める。番組の時刻を扱うコードを書くときはここを通すこと
- **ログイン認証と権限** (`src/model/auth/`): `config.yml` の `auth.enabled` で有効化 (既定 無効)。パスワード (scrypt) と **SSO (Google / GitHub, OAuth 2.0 認可コードフロー)** に対応し、セッションは HMAC 署名付き HttpOnly Cookie。**最初にサインアップした人が自動でシステム管理者**、以降は一般権限で、管理者が随時権限を付与できる。`/api/settings`・`/api/auth/users`・`/api/update`・`/api/logs` は管理者限定 (403)。SSO のクライアント ID / シークレットはログイン前に必要なため config.yml に置く
- **更新通知とワンクリック更新** (`src/model/update/`): Operator が GitHub Releases を定期確認し、新しい版があれば Web UI 右上にトーストを出す (プレリリースは色違い)。更新はサーバー設定画面の「更新」タブ (共通コンポーネント `UpdatePanel.vue`) から実行し、**リリース版 (タグ)** と **開発版 (`main` ブランチの最新コミット)** の 2 系統を選べる。処理は `git checkout` → `npm run all-install` → `compile` + クライアントビルドで、完了後に Operator を終了して**サービス管理 (docker / systemd / pm2 / Windows サービス) に再起動させる**。管理下でない場合のみ後継プロセスを自分で spawn する。git clone した環境でのみ実行可能で、配布アーカイブ環境は案内のみ。API は `/api/update` 系、制御は機能フラグ `updateNotification` と `config.yml` の `updateChecker`
- **Windows サービス** (`scripts/win-service.js`): サービス登録は `node-windows` (optionalDependencies)。`npm run install-win-service` / `uninstall-win-service` / `status-win-service`。サービスは LocalSystem・セッション 0 で動きユーザーの PATH を参照できないため、登録時にサービス専用の `Path` と `git config --system safe.directory` を設定する。実行時にも `src/util/GitCommand.ts` が git の場所解決・`-c safe.directory` 付与・Windows での npm.cmd の shell 起動を担う (これが無いとワンクリック更新が動かない)
- **リリースタグとバージョン比較の注意**: 本フォークのタグは `2.14.0-stuayu-260727`、`package.json` は `2.14.0-stuayu` と日付サフィックスの有無が違う。素の semver 比較だと自分自身より新しい版があるように見えるため、`src/util/VersionUtil.ts` が日付サフィックスを別枠で扱う。現在バージョンの解決は `src/util/CurrentVersion.ts` (git 管理下なら `git describe --tags` を優先) に集約され、`GET /api/version` (ナビゲーション左上の表記) と更新画面の両方がこれを使う。バージョン判定を触るときはここを壊さないこと
- **エイリアス辞書 (`series_alias`) の誤学習は設定画面から直せる**。LLM が自動学習した「正規化タイトル → シリーズ」は確度 1.0 で確定させるため誤りの影響が大きい。サーバー設定 > シリーズ管理タブの表から付け替え・削除ができ (`PUT /api/series/aliases/{aliasId}` / `POST /api/series/aliases/bulk`)、**付け替えたものは `source: 'manual'` になって以後の自動学習で上書きされない**。引き当てキーである `normalizedTitle` は変更させない
- **シリーズの表示名は外部辞書の正式タイトルへ同期する**。`SeriesMetadataFiller.fill()` (起動 10 分後 + 設定画面の「メタデータ再取得」) が作品辞書を引き、`series.title` が辞書名と違えば上書きする。更新するのは表示名だけで、**自動判定の引き当てキー `normalizedTitle` は録画タイトル由来のまま変えない**。出所は `series.titleSource` (`dictionary` / `manual` / null) で持ち、手動で付けた名前は再取得で上書きしない。手動編集はシリーズ一覧の編集ダイアログ (`PUT /api/series/{seriesId}/metadata` の `title`。`null` を送ると手動設定を解除して次回の再取得で辞書名へ戻す)
- シリーズの誤生成を掃除する導線が画面にある。**シリーズの出所** (`SeriesListItem.origin`) は外部 ID (`syobocalTid` / `annictId` / `wikidataQid`) の有無で `dictionary` / `local` を判定する (`src/model/series/SeriesOrigin.ts`)。一覧はチェックボックスで複数選択して `POST /api/series/merge` (`fromSeriesIds`) にまとめて流し、統合先は**辞書起点のシリーズを既定**にする (自動判定がそこへ寄るため)。マージ候補は `GET /api/series/{seriesId}/merge-candidates` が正規化タイトルの前方一致で返す (`src/model/series/SeriesMergeCandidates.ts`)
- 話数・放送種別 (初回 / 再放送 / 遅れ放送 / 不明) はシリーズ詳細の一括編集モードから `POST /api/series/mappings/bulk` でまとめて更新する。**省略した項目は現在値を維持**し、エイリアス学習は既定で行わない (話数の付け直しでタイトル辞書を汚さないため)
- シリーズ一覧のアイキャッチ画像は Annict 由来 (しょぼいカレンダーは画像を提供しない)。Annict の URL は作品公式サイトの OGP 画像を指し http:// も混ざるため、直リンクせず `SeriesImageModel` がサーバ側で取得して `data/seriesImage/` にキャッシュし `GET /api/series/{seriesId}/image` で配信する。画像が取れない作品は録画サムネイルで代用する
- **Annict GraphQL API に `Query.works` は存在しない** (`searchWorks` のみ)。`Episode` に `airedAt` も無い。存在しないフィールドを要求するとクエリ全体が GraphQL エラーになるため、クエリを書くときは実 API のスキーマ (introspection) で確認すること
- ライブ HLS は 2 モード: cmd が `%streamFileDir%` を含まなければ in-memory 配信 (`HLSMemoryStoreModel`、ディスク書き込みなし)、含めば従来のディスク方式。**どちらも ARIB 字幕に対応**し、in-memory 側は ID3 を `emsg` box (version 1 必須) で運ぶ。詳細は `doc/streaming-refresh.md`
- エンコード cmd に `|` を含むとシェル経由で実行される (tsreadex 前処理用)。`%TSREADEX%` は config の `tsreadex` で置換される
- ストリーミング API の `req.query` は express-openapi が OpenAPI スキーマに従い数値へ型変換する。`mode` 等のクエリを文字列前提で扱わないこと
