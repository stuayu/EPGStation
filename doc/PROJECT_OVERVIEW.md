# EPGStation (stuayu フォーク) プロジェクト概要

日本の DTV 録画管理ソフトウェア EPGStation のフォーク版。
上流は [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) で、本フォーク (stuayu 版) は
**Windows 完全対応**・**県外地上波対応 (NW1〜NW40 チャンネル型の追加)**・**Mirakurun dev 版 (stuayu/Mirakurun) との連携** を主軸に拡張している。
フォーク独自の変更点は [stuayu-fork.md](stuayu-fork.md) を参照。

- 言語/ランタイム: TypeScript / Node.js 24 LTSのみ (CIでは24.xを検証)
- サーバ: Express 5 + express-openapi, TypeORM 1.0 (SQLite / MySQL), inversify (DI), log4js, socket.io
- クライアント: Vue 3 + Vuetify 4 (クラスコンポーネント + デコレータ, `vue-facing-decorator`), inversify による独自 State 管理 (Vuex 不使用)。ビルドは Vite
- 動画再生: [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) に統一 (GitHub タグ固定)。HLS は hls.js、低遅延ライブは mpegts.js、ARIB 字幕は DPlayer 内蔵の aribb24.js を利用 (`client/src/components/video/`)
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

| パス | 役割 |
|---|---|
| `src/index.ts` | エントリポイント (Operator)。init → runOperator → runService → cleanup → runEPGUpdater |
| `src/@types/` | グローバル型定義 |
| `src/db/entities/` | TypeORM エンティティ (Channel, Program, Recorded, Reserve, Rule, Thumbnail, VideoFile など) |
| `src/db/migrations/{mysql,sqlite}/` | DB 種別ごとのマイグレーション (postgres は空 = 実質未対応) |
| `src/lib/` `src/util/` | 汎用ライブラリ / 純粋関数ユーティリティ |
| `src/model/ModelContainerSetter.ts` | **DI バインディングの中心 (約 400 行)。新規クラスは必ずここに登録** |
| `src/model/db/` | TypeORM Repository をラップしたデータアクセス層 (`I*DB.ts` / `*DB.ts`) |
| `src/model/operator/` | 録画エンジン本体: reservation / recording / recorded / rule / storage / thumbnail / externalCommand |
| `src/model/epgUpdater/` | EPG 更新 (Mirakurun イベントストリーム購読 + 定期実行) |
| `src/model/event/` | EventEmitter ベースの内部イベント |
| `src/model/ipc/` | Operator ⇔ Service 間 IPC |
| `src/model/api/` | API ビジネスロジック層 (express 非依存) |
| `src/model/service/api/` | express-openapi ルートハンドラ。**ディレクトリ構造 = URL パス** (例: `api/reserves/{reserveId}.ts` → `/api/reserves/{reserveId}`) |
| `src/model/service/encode/` | エンコードプロセス管理 |
| `src/model/service/stream/` | ライブ/録画済み × 通常/HLS のストリーミング |
| `src/model/Configuration.ts` | `config/config.yml` の読み込み (fs.watchFile によるホットリロード付き) |

### クライアント (`client/src/`)

| パス | 役割 |
|---|---|
| `main.ts` | エントリ。DI コンテナ初期化 → サーバ config 取得 → Vue 生成 |
| `router.ts` | vue-router ルート定義 (全 18 ページ) + スクロール位置復元 |
| `views/` | ページコンポーネント |
| `components/` | 機能別の再利用コンポーネント (guide, recorded, reserves, search, video など) |
| `model/ModelContainerSetter.ts` | クライアント側 DI 登録 (サーバと同じパターン) |
| `model/api/` | REST API ラッパー (`RepositoryModel` = axios 共通層 + 機能別 `*ApiModel`) |
| `model/state/` | 画面ごとの State クラス (Vuex の代わり) |
| `model/storage/` | localStorage 永続化 |
| `model/socketio/` | socket.io クライアント (`updateStatus` / `updateEncode` イベント購読) |

### API 仕様の共有

- ルートの **`api.yml`** (OpenAPI 3.0.1) が API 仕様の正。express-openapi がこれを読み込んでバリデーション/ルーティングする
- ルートの **`api.d.ts`** がサーバ・クライアント共有の型定義 (`import * as apid from '.../api'` で参照)
- 本フォークでは `ChannelType` に `NW1`〜`NW40` を追加済み

## 主要ワークフロー別・変更対象ファイル

| やりたいこと | 触るファイル |
|---|---|
| API エンドポイント追加 | `api.yml` → `src/model/service/api/**` → `src/model/api/**` → `ModelContainerSetter.ts` → `api.d.ts` |
| DB スキーマ変更 | `src/db/entities/` → `npm run orm-gen --db=<mysql\|sqlite> --name=<Name>` (**mysql/sqlite 両方**) → `src/model/db/**` |
| 録画・予約ロジック | `src/model/operator/{reservation,recording,rule}/**` |
| EPG 更新 | `src/model/epgUpdater/**` |
| エンコード | `src/model/service/encode/**` |
| ストリーミング | `src/model/service/stream/**` |
| Operator⇔Service 通信追加 | `src/model/ipc/IPCMessageDefine.ts`, `IPCServer.ts`, `IPCClient.ts` |
| 設定項目追加 | `src/model/IConfigFile.ts`, `Configuration.ts` (DEFAULT_VALUE), `config/config.yml.template` (+ `config-win.yml.template`) |
| クライアント新ページ | `client/src/views/` → `router.ts` → `model/state/**` → `model/ModelContainerSetter.ts` → ナビゲーション |

## コーディング規約 (両側共通)

- **インターフェース分離**: DI 対象は必ず `IXxx.ts` (インターフェース) + `Xxx.ts` (実装, `@injectable()`) のペア。文字列トークン `'IXxx'` でバインドし、利用側は `container.get<IXxx>('IXxx')`
- **命名**: PascalCase + 役割サフィックス (`~Model`, `~ManageModel`, `~DB`, `~ApiModel`, `~State`, `~Util`)。ファイル名 = クラス名
- **namespace 定数**: クラス定義直後に同名 `namespace Xxx { export const ... }` で定数を定義
- **Provider パターン**: 複数インスタンスが必要なもの (Recorder, Encoder, Stream) は `toProvider()` でファクトリ注入
- **JSDoc 風の日本語コメント** を public メソッドに付与
- **エラーハンドリング**: サーバ API は try/catch → `api.responseServerError()`。クライアントは try/catch → `ISnackbarState.open()` + `console.error`
- Lint/Format: ESLint + Prettier。`npm run build-server` に lint/format が組み込まれている

## ビルド・運用

```bash
npm run all-install   # サーバ + クライアントの依存インストール
npm run build         # Linux/Mac (build-win で Windows)
npm start             # node dist/index.js
npm run backup / restore   # DB バックアップ / リストア
```

- テストは未整備 (`npm test` はエラーを返すだけ)。動作確認はビルド + 手動確認
- 設定: `config/config.yml` (テンプレートから起動時自動コピー)。ログ設定は `config/{operator,service,epgUpdater}LogConfig.yml`
- マイグレーションは起動時に自動実行 (`migrationsRun: true`)
- Docker: `Dockerfile.alpine` (node:24-alpine3.24 ベース) / `Dockerfile.debian` (node:24-trixie ベース) のマルチステージ
- CI: `.github/workflows/build-validation.yml` (3 OS × Node 24 のビルド検証、Mirakurun `stuayu-main` ブランチと組み合わせ)、`docker.yml` (マルチアーチイメージの Docker Hub push)

## 注意点・ハマりどころ

- `ormconfig.js` (CLI マイグレーション用) は `Configuration.ts` とは別に `config/config.yml` を独自に読む二重管理になっている
- postgres のマイグレーションディレクトリは空。対応 DB は sqlite / mysql のみ
- `mirakurun` 依存はフォーク版 (`stuayu/Mirakurun`) のコミット固定。ブランチ tarball 参照にすると Mirakurun 側の push で lockfile の integrity が壊れ CI が落ちるため、必ずコミット SHA の URL で固定する
- Windows 対応が本フォークの柱。サーバ側変更時は Windows での動作 (パス区切り、named pipe など) を常に考慮すること
- Express 5 では `req.query` がアクセスごとに再パースされる getter になったため、`ServiceServer.ts` でリクエスト受信時に一度だけ実体化するミドルウェアを挟んでいる
- TypeORM 1.0 では criteria が空の `delete()` が禁止されているため、全件削除は `createQueryBuilder().delete()` を使う (既存コードは対応済み)
