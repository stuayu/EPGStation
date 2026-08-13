# CLAUDE.md

EPGStation (stuayu フォーク) — 日本の DTV 録画管理ソフトウェア。**Windows 完全対応**と**県外地上波 (NW1〜NW40)** がフォークの主眼。

## ドキュメント

自動読み込み (アーキテクチャと注意点の本体):

@doc/PROJECT_OVERVIEW.md

タスクが該当するときだけ Read で読む:

| ドキュメント | 読むとき |
| --- | --- |
| `doc/stuayu-fork.md` | フォーク独自機能の詳細 (変更の背景と経緯が全部ここ) |
| `doc/streaming-refresh.md` | ライブ/録画配信・エンコード・プレイヤー UI を触るとき |
| `doc/conf-manual.md` | 設定項目を追加・変更するとき |
| `api.yml` | API を追加・変更するとき (OpenAPI 定義の正) |
| `doc/webapi.md` | API の挙動を確認するとき |
| `doc/windows-setup.md` / `doc/linux-setup.md` | 環境構築の質問に答えるとき |

## ドキュメント更新ルール (必須)

コードを追加・修正したら、**同じ作業の中で関連ドキュメントも更新する**。実装完了 = ドキュメント更新完了。

- 機能追加・挙動変更 → `doc/stuayu-fork.md`。アーキテクチャ・注意点が変わるなら `doc/PROJECT_OVERVIEW.md` も
- API → `api.yml` + `api.d.ts` (`doc/webapi.md` は Swagger UI 参照方式のため通常不要)
- 設定項目 → `doc/conf-manual.md` + `config/config.yml.template` + `config/config-win.yml.template`
- ストリーミング → `doc/streaming-refresh.md`
- セットアップ手順 → `doc/windows-setup.md` / `doc/linux-setup.md`
- 更新不要と判断した場合は、最終報告でその理由を書く

## エージェント運用 (指示役 = Fable / Opus)

最上位モデルはオーケストレータとして動き、実作業はサブエージェントへ委譲する (自分で大量のコードを読み書きしない)。

- Sonnet: コード調査、実装計画、実装、リファクタリング、バグ修正
- Haiku: 単純な列挙・検索、ログ確認、機械的な置換
- 独立したタスクは並列で起動する。委譲時は「対象ディレクトリ」「読み取り専用か編集可か」「報告フォーマット (日本語 + 相対パス)」を明示する
- 報告は鵜呑みにせず、重要な結論はファイルを直接見て検証してから統合する

## コマンド

```bash
npm run all-install    # 依存インストール (サーバ + client)
npm run build          # フルビルド (Windows は build-win)
npm run compile        # サーバの tsc のみ (高速な型チェック)
npm run lint           # eslint --fix (src/)
npm run format         # prettier (src/)
cd client && npm run build   # クライアントの型チェック + ビルド (vue-tsc)

npm test               # ut + ita (コミット前に必ず通す)
npm run test:ut        # 単体 (行カバレッジ 80% 未満で失敗)
npm run test:ita       # 結合 A (実 sqlite でのマイグレーション等)
npm run test:itb       # 結合 B (ローカル HTTP スタブサーバを使う通信系)
npm run test:ci        # ut + ita + itb
```

- 新規モジュールを追加したらテストも追加する (`test:ut` にカバレッジゲートがある)
- テストは `dist/` を `require()` する。**DI クラスをコンストラクタ引数の位置指定で組み立てているテストがある**ため、依存を足すときは引数を末尾に追加し、該当テストのスタブも直す
- クライアントに lint は無い。型チェックは `cd client && npm run build`
- `npm run build-server` は lint + format を含みファイルを書き換える。型チェックだけなら `npm run compile`

## コーディング規約

- DI 対象は `IXxx.ts` (インターフェース) + `Xxx.ts` (`@injectable()`) のペア。文字列トークンで bind し、**`src/model/ModelContainerSetter.ts` (クライアントは `client/src/model/ModelContainerSetter.ts`) への登録が必須**
- クラス名 = ファイル名。役割サフィックス (`~ManageModel` / `~DB` / `~ApiModel` / `~State` / `~Util`) を踏襲
- public メソッドに JSDoc 風の日本語コメント (`@param` / `@return`)
- 定数はクラス直後の同名 `namespace` に置く (`export default class` は namespace マージ不可なので `private static readonly`)
- コミットメッセージは日本語。`Fix:` / `Add:` / `Update:` プレフィックス

## 踏むと壊れるところ

詳細と背景は `doc/PROJECT_OVERVIEW.md` と `doc/stuayu-fork.md` にある。ここは「知らずに触ると壊す」ものだけ。

### 環境・ビルド

- **Windows 対応が最優先**。パスは `path.join`、Mirakurun の named pipe 対応を壊さない。CI は 3 OS × Node 24
- `mirakurun` 依存は `stuayu/Mirakurun` の**タグで固定**する (現在 `#4.2.0-stuayu`)。ブランチ参照は lockfile が壊れて CI が落ちるため禁止
- `git+https` は npm の `allow-git` 制限対象。リポジトリの `.npmrc` に `allow-git=all` がある (無い環境は `NPM_CONFIG_ALLOW_GIT=all`)

### 設定・DB

- 設定項目の定義元は `src/model/config/ConfigSchema.ts` の 1 箇所。追加したら**両テンプレート**を更新する (`test/ut/config-schema-template-sync.test.js` が記載漏れを検知)
- `ormconfig.js` は `Configuration.ts` と別実装で config.yml を読む。読み方を変えるなら両方直す
- DB は sqlite / mysql のみ。マイグレーションは `npm run orm-gen --db=<mysql|sqlite> --name=<Name>` で**両方**生成する
- **機能フラグ (`featureFlags`) は opt-out**。未指定 = 有効 (`!== false` 判定)。テストで無効を表すときは該当キーに `false` を明示する
- 秘密情報の暗号化鍵は `data/key/secret.key` に自動生成 (config の `secretKey` は廃止。パスは `EPGSTATION_SECRET_KEY_FILE` で上書き可)

### サーバ

- `ChannelType` に `NW1`〜`NW40` (県外地上波) と `BS4K` / `CS4K` がある。GR/BS/CS/SKY だけを前提にしない
- `req.query` は express-openapi がスキーマに従い数値へ型変換する。`mode` 等を文字列前提で扱わない
- エンコード cmd に `|` を含むとシェル経由で実行される (tsreadex 前処理用)。`%TSREADEX%` は config の `tsreadex` で置換

### クライアント (Vue 3 + vue-facing-decorator)

- **クラスフィールドに書いたコールバックの `this` は Vue インスタンスではない**。フィールドの初期値は data 用の一時インスタンスから集められ、**メソッドだけが Vue インスタンスへ束縛される**。`private xxxCallback = ((): void => { ... }).bind(this)` の中から `this.watchParam` のようなデータを読むと初期値しか見えず、条件判定が黙って壊れる。判定・処理はメソッドに置き、フィールドのコールバックはそれを呼ぶだけにする
- **番組表 (`Guide.vue`) のセルは手組み DOM**。データを取り直したら `GuideState.createProgramDoms()` と `Guide.renderProgramDoms()` の**両方**を呼ぶ (後者を呼ばないと画面が古いまま。可視判定の `updateVisible()` もその末尾で走る)
- **`DataBroadcastingManager` は `markRaw()` で包む**。BMLBrowser 内部の JS-Interpreter が Vue のプロキシに包まれると壊れる

### ストリーミング・データ放送

配信周りを触る前に `doc/streaming-refresh.md` を読む。

- **ライブ HLS は 2 モード**。cmd に `%streamFileDir%` が無ければ in-memory 配信 (ディスク書き込みなし)、あれば従来の TS セグメント方式。どちらも ARIB 字幕対応
- **in-memory HLS の字幕 (`emsg`) は必ず version 1**。version 0 だと hls.js が `scheme_id_uri` を読み違え、字幕が一切出ない
- **DPlayer に `type: 'normal'` を渡すと ARIB 字幕が出ない**。Safari のネイティブ HLS でも `type: 'hls'` のままにする
- **BML ブラウザは映像要素を自分の中へ物理的に移動する**。`invisible` の切り替えと破棄時に元へ戻す処理を落とさない
- **データ放送の WebSocket は socket.io と同じサーバの `upgrade` に相乗りする**。パスが `<subDirectory>/api/dataBroadcasting/ws` 以外の socket には触らない (触ると socket.io のハンドシェイクが壊れる)

### シリーズ判定

主軸は外部の作品辞書 (しょぼいカレンダー / Annict / Wikidata)。判定順や確度は `doc/PROJECT_OVERVIEW.md` に書いてある。

- **「放送局 + 放送開始時刻」の照会が最優先**。タイトル照合より確度が高い。うまく判定できないときは辞書・放送予定側を先に疑う
- **`SeriesBackfillManageModel.decide()` (ドライラン) は `resolve()` とは別実装**。判定順を変えたら両方直す (揃っていないとプレビューと実行結果が食い違う)
- **辞書間の重複はしょぼいカレンダー TID で結合する**。新しい辞書を足すときも同じキーで合流させ、作品を二重に作らない
- **Wikidata 由来のエントリは完全一致 (`strictProgramKey()`) のみで引く**。一般番組は短いタイトルが多く、含有一致だと誤爆する
- **Annict GraphQL はクエリを introspection で確認してから書く** (`Query.works` は無く `searchWorks` のみ、`Episode.airedAt` も無い)。存在しないフィールドが 1 つあるとクエリ全体がエラーになる
- `SeriesNormalizer` を変更したら `test/ut/series-normalizer.test.js` と `test/ita/series-backfill-idempotency.test.js` を必ず通す (テストが表記ゆれの意図を固定している)

### TS 解析・録画表示

- **`TsInfoAnalyzer` は既定でファイル中央から読む** (先頭には前番組の EIT[p/f] と壊れた TS が混ざるため)。`firstTdtAt` は「ファイル先頭の放送時刻」という意味を保つこと
- **相乗りサービス (ワンセグ・サブチャンネル・データ放送) からの本編選択は `selectServiceId()`**。パケット数の偏りを見るため最低 20000 パケットは読む
- **番組情報の上書きは明示的な再解析のときだけ**。取り込み・アップロード時と「未解析のみ」の一括解析は空の項目を補うだけ。番組名 (`recorded.name`) はどちらでも上書きしない
- 録画の放送局名は `ChannelNameUtil.getRecordedChannelName()`、一覧のタイトル表示は `RecordedUtil.convertRecordedItemToDisplayData()` の 1 箇所で決まる
