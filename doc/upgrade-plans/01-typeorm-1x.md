# 作業指示書 01: TypeORM 0.3.20 → 1.x アップデート

あなたは EPGStation (stuayu フォーク, /path/to/EPGStation) の TypeORM を 0.3.20 から最新の 1.x 系へアップデートする作業を行う。
**最優先事項は既存ユーザーの DB を壊さないこと。** 録画予約・録画履歴が入った稼働中の sqlite / mysql DB がそのまま移行できなければならない。

作業前に `CLAUDE.md` と `doc/PROJECT_OVERVIEW.md` を読み、リポジトリの規約 (DI パターン、日本語コミット、ドキュメント更新ルール) に従うこと。

## 0. 事前調査 (必須・実装より先に行う)

自分の学習知識で TypeORM 1.x の変更点を推測してはならない。必ず以下を確認する:

1. TypeORM 公式の 1.0 リリースノート / 移行ガイド / CHANGELOG (typeorm.io と GitHub releases) を読む
2. 特に以下の互換性を確認する:
   - `DataSource` の設定形式・CLI (`typeorm migration:generate` / `migration:run`) の引数形式の変更
   - 対応 Node.js バージョンの下限 (本リポジトリは Node 18/20/22 を CI で検証。下限が上がるなら CI・Dockerfile・engines も更新)
   - `mysql` (2.18.1) ドライバの継続サポート。**TypeORM 1.x が mysql2 を要求する場合は mysql2 へ移行**し、接続オプションの差分 (`charset` 等) を吸収する
   - `sqlite3` (5.1.7) の対応状況。better-sqlite3 が推奨になっている場合も、まずは既存ドライバ維持を優先し、変更する場合は理由を報告に書く
   - マイグレーションテーブル (`migrations`) のスキーマ・記録形式が 0.3 と互換か
   - `find` / `findOne` / `Repository` API、デコレータ (`@Entity`, `@Index` 等) の破壊的変更

## 1. このリポジトリ固有の変更対象

- `package.json` — typeorm, (必要なら) mysql→mysql2, sqlite3, reflect-metadata
- `src/db/entities/*.ts` — エンティティ定義。デコレータ変更があれば追従
- `src/model/db/DBOperator.ts` ほか `src/model/db/*DB.ts` — Repository ラッパー層。API 変更に追従
- `ormconfig.js` — **注意: `src/model/Configuration.ts` とは別実装で `config/config.yml` を独自に読む二重管理**。TypeORM 1.x の CLI/DataSource 形式に合わせて書き直す場合、config.yml の読み方 (mysql/sqlite の切替、Windows パス) を両方の実装で一致させたまま保つこと
- `package.json` の scripts: `orm-gen` (`typeorm migration:generate src/db/migrations/${npm_config_db}/${npm_config_name} -d ./ormconfig.js`) と `orm-run` — CLI 形式変更に追従。**mysql / sqlite 両方のマイグレーションを生成できる仕組みを維持する**
- `src/IConnectionCheckModel` / DB 接続チェック、`npm run backup` / `npm run restore` スクリプトの実装 (DB を直接触るツールがあれば追従)

## 2. 絶対に守ること

- **既存のマイグレーションファイル (`src/db/migrations/{mysql,sqlite}/*.ts`) の内容・ファイル名・タイムスタンプを変更しない**。既存 DB の migrations テーブルと突合されるため、書き換えると再実行や不整合が起きる。1.x でシグネチャ変更が必須の場合のみ、実行結果 (SQL) が同一であることを確認した上で最小限の機械的修正に留め、報告に明記する
- 起動時の自動マイグレーション (`migrationsRun: true`) の挙動を維持する
- 対応 DB は sqlite / mysql のみ (postgres ディレクトリは空で未対応。対応を増やさない)
- `ChannelType` に NW1〜NW40 が存在する (エンティティの型を GR/BS/CS/SKY 前提にしない)
- ESM 化はこのステップでは行わない (次ステップの範囲)。CommonJS ビルドのまま完結させる

## 3. 検証手順 (すべて実施し、結果を報告する)

1. `npm run compile` が成功する
2. **sqlite 新規作成テスト**: 一時ディレクトリに sqlite 設定の config.yml を用意してサーバを起動し、全マイグレーションが順番に適用されて起動完了することをログで確認
3. **sqlite 移行テスト**: 0.3.20 時点のコード (git stash か別クローン) で作った DB ファイルに対し、更新後コードで起動して追加マイグレーションなし・エラーなしで起動できることを確認
4. mysql はローカルに環境があれば同様に確認。なければ「未検証」と報告に明記する (勝手に検証済みとしない)
5. `npm run orm-gen --db=sqlite --name=TestDummy` がエラーなく動くこと (生成されたダミーファイルは削除する)。mysql 側も同様
6. 主要クエリの動作確認: サーバ起動後、`/api/channels`, `/api/recorded`, `/api/reserves` が 200 を返すこと

## 4. 完了時

- `doc/stuayu-fork.md` の「変更箇所」と、`doc/PROJECT_OVERVIEW.md` の技術スタック行 (TypeORM バージョンに言及があれば) を更新
- 日本語コミット (`Update: TypeORM を 1.x に更新` 等)。ドライバ変更 (mysql→mysql2 等) をした場合はコミットメッセージと `doc/conf-manual.md` の DB 設定説明に反映
- 報告: 変更ファイル一覧、採用した 1.x での破壊的変更への対応内容、検証結果 (未検証項目は明示)、ユーザーへの移行時注意点
