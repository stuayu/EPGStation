# CLAUDE.md

EPGStation (stuayu フォーク) — 日本の DTV 録画管理ソフトウェア。

## 自動読み込みドキュメント

@doc/PROJECT_OVERVIEW.md

## 必要時に参照するドキュメント

タスクが該当するときのみ Read で読むこと (自動読み込みしない):

- `doc/stuayu-fork.md` — フォーク独自の変更点の詳細。フォーク固有機能 (NW チャンネル、Windows 対応) を触るとき
- `doc/conf-manual.md` — 設定項目の詳細マニュアル。config 関連の変更時
- `doc/webapi.md` — WebAPI 仕様。API の挙動を確認するとき
- `doc/streaming-refresh.md` — ストリーミング刷新 (in-memory HLS・低遅延配信・プレイヤー UI) の設計と制限。ライブ/録画配信・エンコード周りを触るとき
- `api.yml` — OpenAPI 定義の正。API エンドポイント追加・変更時
- `doc/windows-setup.md` / `doc/linux-setup.md` — セットアップ手順。環境構築の質問対応時

## ドキュメント更新ルール (必須)

コードを追加・修正したら、**同じ作業の中で必ず関連ドキュメントも更新する**こと。実装完了 = ドキュメント更新完了。

- 機能追加・挙動変更 → `doc/stuayu-fork.md` の「変更箇所」に追記。アーキテクチャ・依存関係・注意点が変わる場合は `doc/PROJECT_OVERVIEW.md` も更新
- API エンドポイント追加・変更 → `api.yml` (正) + `api.d.ts` (doc/webapi.md は Swagger UI 参照方式のため通常更新不要)
- 設定項目の追加・変更 → `doc/conf-manual.md` + `config/config.yml.template` + `config/config-win.yml.template`
- セットアップ手順に影響する変更 → `doc/windows-setup.md` / `doc/linux-setup.md`
- ストリーミング (配信・エンコード・プレイヤー) の変更 → `doc/streaming-refresh.md` に追記
- ドキュメント更新が不要と判断した場合も、最終報告でその判断理由を明示する

## エージェント運用方針 (指示役 = Fable 5)

このプロジェクトでは **Fable・Opus (最上位モデル) が指示役 (オーケストレータ)** として動き、実作業はサブエージェントに委譲する。

- **Fable・Opus (指示役)**: タスク分解、方針決定、サブエージェントへの指示、結果の検証・統合、最終レビュー。自分で大量のコードを読み書きしない
- **Sonnet に委譲**: コード調査 (Explore)、実装計画 (Plan)、機能実装、リファクタリング、バグ修正などの主要作業
- **Haiku に委譲**: 単純な列挙・検索、定型的な調査 (設定ファイル一覧、ログ確認など)、機械的な置換作業

運用ルール:

- 独立したタスクは並列で複数エージェントを起動する
- 委譲時は「対象ディレクトリ」「読み取り専用か編集可か」「報告フォーマット (日本語 + 相対パス付き)」を明示する
- サブエージェントの報告は鵜呑みにせず、重要な結論は Fable 5 がファイルを直接確認して検証してから統合する

## ビルド・検証コマンド

```bash
npm run all-install    # 依存インストール (サーバ + client)
npm run build          # Linux/Mac フルビルド (build-win: Windows)
npm run compile        # サーバの tsc のみ (高速な型チェックに使う)
npm run lint           # eslint --fix (src/)
npm run format         # prettier (src/)
cd client && npm run build  # クライアントの型チェック + ビルド

npm test               # ut + ita (コミット前に必ず実行する)
npm run test:ut        # 単体 (test/ut/, 行カバレッジ 80% 未満で失敗)
npm run test:ita       # 結合 A (test/ita/, 実 sqlite でのマイグレーション等)
npm run test:itb       # 結合 B (test/itb/, ローカル HTTP スタブサーバを使う通信系)
npm run test:ci        # ut + ita + itb
```

- **テストは存在する** (node:test ベース、`test/ut` `test/ita` `test/itb`)。コード変更後は `npm test` を必ず通すこと。`npm run test:ut` は**行カバレッジ 80% のゲート付き**なので、新規モジュールを追加したら対応するテストも追加する
- テストは `dist/` を `require()` する (各スクリプトが先に `npm run compile` を実行する)。DI 対象クラスは**コンストラクタ引数を位置指定で組み立てているテストがある**ため、依存を追加するときは引数を末尾に足し、該当テストのスタブも更新する
- クライアント側に lint スクリプトは無い。型チェックは `cd client && npm run build` (vue-tsc + vite build) で行う
- `npm run build-server` は lint + format を含むためファイルを書き換える。型チェックだけなら `npm run compile`

## アーキテクチャ要点 (最低限)

- **2 プロセス構成**: Operator (親: 予約・録画・EPG 更新, `src/index.ts`) と Service (子: Web API・配信・エンコード, `src/model/service/ServiceExecutor.ts`)。通信は `src/model/ipc/`
- **DI (inversify)**: すべて `IXxx.ts` + `Xxx.ts` のペア。新規クラスは `src/model/ModelContainerSetter.ts` (クライアントは `client/src/model/ModelContainerSetter.ts`) への登録が**必須**
- **API**: ルートの `api.yml` (OpenAPI) が正。`src/model/service/api/` はディレクトリ構造 = URL パス。共有型は `api.d.ts`
- **DB**: TypeORM、対応は **sqlite / mysql のみ**。マイグレーションは両 DB 分を `npm run orm-gen --db=<mysql|sqlite> --name=<Name>` で生成
- **クライアント**: Vue 3 + Vuetify 4 のクラスコンポーネント (`vue-facing-decorator`)。状態管理は Vuex ではなく inversify + State クラス (`client/src/model/state/`)

## コーディング規約

- インターフェース分離 (`IXxx` + `Xxx`) と文字列トークン DI を厳守。既存パターンから逸脱しない
- クラス名 = ファイル名。役割サフィックス (`~ManageModel`, `~DB`, `~ApiModel`, `~State`) を踏襲
- public メソッドには JSDoc 風の日本語コメント (`@param` / `@return`)
- 定数はクラス直後の同名 `namespace` に定義 (`export default class` は namespace マージ不可のため `private static readonly` を使う)
- コミットメッセージは日本語 (既存履歴の `Fix:` / `Add:` / `Update:` プレフィックス形式に従う)

## このフォーク特有の注意点

- **Windows 対応が最重要**。パス処理は `path.join`、Mirakurun 接続は named pipe 対応を壊さないこと。CI は 3 OS × Node 24 で検証される
- `ChannelType` に `NW1`〜`NW40` (県外地上波) が追加されている。チャンネル種別を扱うコードでは GR/BS/CS/SKY だけを前提にしない
- `mirakurun` 依存は `stuayu/Mirakurun` の**タグで固定**する (現在は `git+https://github.com/stuayu/Mirakurun.git#4.2.0-stuayu`)。**ブランチ参照は禁止** (`#stuayu-main` のようなブランチ指定は Mirakurun 側の push のたびに解決先が変わり lockfile が壊れて CI が落ちる)。更新時は package.json のタグを差し替えて `npm install` で lockfile を更新する
- `git+https` 形式は npm の依存元制限 (`allow-git`) の対象。リポジトリの `.npmrc` に `allow-git=all` を置いてあり、無い環境では `npm run all-install` が mirakurun のインストールで失敗する (PowerShell なら `$env:NPM_CONFIG_ALLOW_GIT="all"` で回避)
- 設定項目を追加したら `config/config.yml.template` と `config/config-win.yml.template` の**両方**を更新する
- `ormconfig.js` は `Configuration.ts` と別実装で config.yml を読む (二重管理)。設定の読み方を変える場合は両方直す
- **ライブ HLS は 2 モード**: cmd が `%streamFileDir%` を含まない場合は in-memory 配信 (fMP4 を `Fmp4Packager` → `HLSMemoryStoreModel` でメモリ保持、ディスク書き込みなし・Windows 対応)。含む場合は従来の TS セグメント方式。**どちらも ARIB 字幕に対応**する (in-memory 側は ID3 を `emsg` box で運ぶ)。配信周りを触る前に `doc/streaming-refresh.md` を読むこと
- **DPlayer に `type: 'normal'` を渡すと ARIB 字幕が出ない**。`initMSE()` の `switch` に `case 'normal'` / `default` が無く、aribb24 の CanvasRenderer を作るのは `case 'hls'` / `case 'mpegts'` の中だけ。Safari でネイティブ HLS 再生にしたい場合は `type: 'hls'` のまま `DPlayerUtil.setupGlobals()` が `window.Hls.isSupported()` を `false` に見せて、DPlayer 側にネイティブ HLS + in-band metadata 自動検出の分岐を選ばせる (詳細は `doc/streaming-refresh.md`)
- **in-memory HLS の字幕 (`emsg`) は必ず version 1 で出す**。hls.js の `parseEmsg()` は version 0 で `version + flags` の 4 byte を読み飛ばさないため、version 0 だと `scheme_id_uri` が空と解釈され `FRAG_PARSING_METADATA` が一度も発火しない (= 字幕が一切出ない)。version 1 は相対時刻ではなく**絶対時刻**なので、セグメント先頭パートの `tfdt` を基準に載せ替えること (`Fmp4Packager.buildEmsgBox()`)
- エンコード cmd に `|` を含むとシェル経由で実行される (tsreadex 前処理用)。`%TSREADEX%` は config の `tsreadex` で置換 (省略時は PATH 上の tsreadex)
- ストリーミング API の `req.query` は express-openapi がスキーマに従い数値へ型変換する。`mode` 等を文字列前提で扱わないこと (過去に 400 エラーの原因になった)
- **シリーズ自動マッピングの主軸は外部の作品タイトル辞書**。しょぼいカレンダー (`SyobocalTitleDictionary`, `syobocal_title` 系 3 テーブル)・Annict (`AnnictWorkDictionary`, `annict_work` 系 2 テーブル)・**Wikidata (`WikidataProgramDictionary`, `wikidata_program` 系 2 テーブル、全ジャンル)** の 3 つを `WorkDictionary` (`src/model/series/`) が 1 つのメモリ索引に統合し、`SeriesResolver` がそれを引く。録画タイトル同士の類似度判定は辞書で引けなかった場合のフォールバックなので、シリーズ判定を触るときは辞書側を先に疑うこと
- **シリーズ判定は「放送局 + 放送開始時刻」の照会を最優先で引く**。`SyobocalProgramLookup` (`src/model/metadata/syobocal/`) がしょぼいカレンダーの放送予定 (`ProgLookup`) を引き、TID・通し話数・サブタイトル・放送回コメントを返す (rigaya/SCRenamePy と同じ考え方)。**その時間に何が放送されていたかは事実なので、タイトル照合より確度が高い**
    - 判定順は ①放送予定 → ②エイリアス辞書 → ③作品辞書 (タイトル照合) → ④LLM → ⑤類似度スコアリング。**エイリアスより放送予定が優先される**が、**手動確定 (`manualLock`) だけは放送予定より強い**
    - 確度は `exactStart` (番組の頭から録画) が 0.98、放送時間帯の包含で拾った場合が 0.92、未登録の地方局を系列キー局で代用した場合 (`viaKeyStation`) が 0.9。代用時は開始時刻がほぼ一致した放送しか拾わない
    - **返ってきた作品名が録画タイトルと共通部分を持たない場合はスキップする** (`isPlausibleProgramTitle()`)。時刻ずれ・キー局代用で別番組を拾ったときの安全弁。完全一致は求めず、含有か 2-gram 類似度 0.25 以上で通す
    - 話数はタイトルに表記があっても放送予定の `Count` を優先する。総集編・一挙放送は `SeriesParseResult.isSpecial` でサブタイトル逆引きの対象外
    - **`SeriesBackfillManageModel.decide()` (バックフィルのドライラン) は `resolve()` とは別実装**。判定順を変えたら必ず両方直す (揃っていないとプレビューと実行結果が食い違う)
- **録画の放送局名は TS 解析 (SDT) の局名を最優先で表示する**。`ChannelNameUtil.getRecordedChannelName()` の順は「TS 解析の局名 (`RecordedItem.tsChannelName`) → 現在の channel 情報 → 録画時点の局名 → networkId/serviceId 表記」。一覧用に `IVideoFileTsInfoDB.findServiceNamesByRecordedIds()` で 1 クエリにまとめて引いている
- **一覧の録画タイトル表示は `RecordedUtil.convertRecordedItemToDisplayData()` の 1 箇所で決まる**。`useDictionaryEpisodeTitle` (localStorage の共通設定) が有効なら `RecordedItem.series` から「作品名 第N話 サブタイトル」を組み立てる。録画済み一覧・ダッシュボード・検索結果はすべてここを通るため、切り替えは 3 点リーダー 1 箇所で全画面に効く
- **しょぼいカレンダーのコメントは 2 種類**。作品コメント (`TitleItem.Comment`) は `series.comment` へ、放送回コメント (`ProgItem.ProgComment`) は `series_episode.comment` へ入る。**作品コメントは辞書の全件同期に含めない** (1 件数 KB で XML が 9.5MB → 24MB になるため)。シリーズになっている作品だけ `ISyobocalTitleDictionary.fetchComment(tid)` で個別に引き、`SeriesMetadataFiller` が埋める。画面から編集・削除すると `commentSource` が `manual` になり自動同期の対象外になる
- **辞書間の重複はしょぼいカレンダー TID で結合して防ぐ**。Annict は `syobocalTid` フィールド、Wikidata は `P11648` を持つ。新しい辞書を足すときも同じキーで既存エントリへ合流させ、作品を二重に作らないこと
- **Wikidata 由来のエントリは `strictProgramKey()` の完全一致のみで引く**。一般番組は短く一般的なタイトル (「パラダイス」等) が多く、アニメ辞書と同じ含有一致を許すと誤爆する。また `syobocalLookupKey()` は長音符を落とすため「あそビバ」と「あそビーバー」が衝突する
- **機能フラグ (`featureFlags`) は opt-out**。未指定は有効として扱う (`isFeatureEnabled` は `!== false` 判定)。テストで「機能無効」を表現するときは `featureFlags: {}` ではなく該当キーに `false` を明示すること
- **Annict GraphQL API のクエリを書くときは実 API のスキーマを introspection で確認すること**。`Query.works` は存在せず `searchWorks` のみ、`Episode` に `airedAt` は無い。存在しないフィールドを 1 つ含めるだけでクエリ全体が GraphQL エラーになる (過去にこれで `get()` / `pushWatchRecord()` が全く動いていなかった)。Annict は全クエリでアクセストークン必須 (未認証は 401)
- 録画タイトルの正規化 (`SeriesNormalizer`) は実データの表記ゆれに合わせた正規表現の塊。**変更したら必ず `test/ut/series-normalizer.test.js` と `test/ita/series-backfill-idempotency.test.js` を通す**こと (「(HDマスター版) は版違いとして残す」「`アニメA 第1話` の `アニメA` は編成ブロック冠ではなく作品名」など、テストが意図を固定している)
- 秘密情報の暗号化鍵は `data/key/secret.key` に自動生成される (config.yml の `secretKey` は廃止、旧値は初回起動時に鍵ファイルへ移行)。パスは環境変数 `EPGSTATION_SECRET_KEY_FILE` で上書き可能
- **データ放送 (BML) は [tsukumijima/web-bml](https://github.com/tsukumijima/web-bml) (otya128/web-bml のフォーク) を npm 依存として使う**。ビルド済み `dist/` をリポジトリにコミットしているフォークなので、submodule もビルド手順も不要で `npm install` だけで使える。サーバは `web-bml/worker` から `decodeTS` を、クライアントは `web-bml` から `BMLBrowser` / `AribKeyCode` を import する。**web-bml 側のエンコード機能・koa サーバは使わない** (映像は引き続き DPlayer が再生し、web-bml は BML の描画専用)
- **BML ブラウザは iframe に隔離せず、`BMLBrowser` を直接生成して DPlayer に組み込む** (`client/src/util/DataBroadcastingManager.ts`)。`BMLBrowser` は内部で closed な Shadow DOM を使うため本体 CSS と衝突しない。**映像要素を BML ブラウザの中へ物理的に移動する** (`bmlBrowser.getVideoElement()` の中へ DPlayer の `videoWrapAspect` を `appendChild`) のが実装の肝で、`invisible` の切り替えや破棄時に元へ戻す処理を忘れると映像が迷子になる
- **`DataBroadcastingManager` (BMLBrowser を保持するクラス) は Vue のリアクティブ監視の対象にしないこと**。BMLBrowser 内部の JS-Interpreter が Vue のプロキシに包まれると壊れるため、保持する側は必ず `markRaw()` で包む。Vue コンポーネントではなくプレーンクラスに切り出しているのもこれが理由
- **データ放送の WebSocket (`DataBroadcastingWebSocketServer.ts`) は socket.io と同じ http/https サーバの `upgrade` イベントに `noServer: true` で相乗りする**。パスが `<subDirectory>/api/dataBroadcasting/ws` と一致しないリクエストの socket には絶対に触れないこと。関係ない socket に触ると同居している socket.io のハンドシェイクが壊れる
- **ARIB のデータ放送は起動直後 `invisible` (非表示) で、d ボタンを押すまで描画されない**。EPGStation では「データ放送を有効にする」操作自体が表示の意思表示なので、`load` 後に最初の 1 回だけ自動で d ボタン (`AribKeyCode.DataButton`) を送っている
