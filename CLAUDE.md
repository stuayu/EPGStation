# CLAUDE.md

EPGStation (stuayu フォーク) — 日本の DTV 録画管理ソフトウェア。

## 自動読み込みドキュメント

@doc/PROJECT_OVERVIEW.md

## 必要時に参照するドキュメント

タスクが該当するときのみ Read で読むこと (自動読み込みしない):

- `doc/stuayu-fork.md` — フォーク独自の変更点の詳細。フォーク固有機能 (NW チャンネル、Windows 対応) を触るとき
- `doc/conf-manual.md` — 設定項目の詳細マニュアル。config 関連の変更時
- `doc/webapi.md` — WebAPI 仕様。API の挙動を確認するとき
- `api.yml` — OpenAPI 定義の正。API エンドポイント追加・変更時
- `doc/windows-setup.md` / `doc/linux-setup.md` — セットアップ手順。環境構築の質問対応時

## ドキュメント更新ルール (必須)

コードを追加・修正したら、**同じ作業の中で必ず関連ドキュメントも更新する**こと。実装完了 = ドキュメント更新完了。

- 機能追加・挙動変更 → `doc/stuayu-fork.md` の「変更箇所」に追記。アーキテクチャ・依存関係・注意点が変わる場合は `doc/PROJECT_OVERVIEW.md` も更新
- API エンドポイント追加・変更 → `api.yml` (正) + `api.d.ts` (doc/webapi.md は Swagger UI 参照方式のため通常更新不要)
- 設定項目の追加・変更 → `doc/conf-manual.md` + `config/config.yml.template` + `config/config-win.yml.template`
- セットアップ手順に影響する変更 → `doc/windows-setup.md` / `doc/linux-setup.md`
- ドキュメント更新が不要と判断した場合も、最終報告でその判断理由を明示する

## エージェント運用方針 (指示役 = Fable 5)

このプロジェクトでは **Fable 5 (最上位モデル) が指示役 (オーケストレータ)** として動き、実作業はサブエージェントに委譲する。

- **Fable 5 (指示役)**: タスク分解、方針決定、サブエージェントへの指示、結果の検証・統合、最終レビュー。自分で大量のコードを読み書きしない
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
cd client && npm run lint   # クライアント側 lint
```

- **テストは存在しない** (`npm test` は常に失敗する)。変更の検証は `npm run compile` (+ クライアントなら `cd client && npm run build`) の成功と手動確認で行う
- `npm run build-server` は lint + format を含むためファイルを書き換える。型チェックだけなら `npm run compile`

## アーキテクチャ要点 (最低限)

- **2 プロセス構成**: Operator (親: 予約・録画・EPG 更新, `src/index.ts`) と Service (子: Web API・配信・エンコード, `src/model/service/ServiceExecutor.ts`)。通信は `src/model/ipc/`
- **DI (inversify)**: すべて `IXxx.ts` + `Xxx.ts` のペア。新規クラスは `src/model/ModelContainerSetter.ts` (クライアントは `client/src/model/ModelContainerSetter.ts`) への登録が**必須**
- **API**: ルートの `api.yml` (OpenAPI) が正。`src/model/service/api/` はディレクトリ構造 = URL パス。共有型は `api.d.ts`
- **DB**: TypeORM、対応は **sqlite / mysql のみ**。マイグレーションは両 DB 分を `npm run orm-gen --db=<mysql|sqlite> --name=<Name>` で生成
- **クライアント**: Vue 2.7 + Vuetify 2 のクラスコンポーネント (`vue-property-decorator`)。状態管理は Vuex ではなく inversify + State クラス (`client/src/model/state/`)

## コーディング規約

- インターフェース分離 (`IXxx` + `Xxx`) と文字列トークン DI を厳守。既存パターンから逸脱しない
- クラス名 = ファイル名。役割サフィックス (`~ManageModel`, `~DB`, `~ApiModel`, `~State`) を踏襲
- public メソッドには JSDoc 風の日本語コメント (`@param` / `@return`)
- 定数はクラス直後の同名 `namespace` に定義
- コミットメッセージは日本語 (既存履歴の `Fix:` / `Add:` / `Update:` プレフィックス形式に従う)

## このフォーク特有の注意点

- **Windows 対応が最重要**。パス処理は `path.join`、Mirakurun 接続は named pipe 対応を壊さないこと。CI は 3 OS × Node 18/20/22 で検証される
- `ChannelType` に `NW1`〜`NW40` (県外地上波) が追加されている。チャンネル種別を扱うコードでは GR/BS/CS/SKY だけを前提にしない
- `mirakurun` 依存は `stuayu/Mirakurun` のコミット固定。勝手にバージョンを動かさない
- 設定項目を追加したら `config/config.yml.template` と `config/config-win.yml.template` の**両方**を更新する
- `ormconfig.js` は `Configuration.ts` と別実装で config.yml を読む (二重管理)。設定の読み方を変える場合は両方直す
- クライアントビルドには `NODE_OPTIONS='--openssl-legacy-provider'` が必要 (npm script に組み込み済み)
