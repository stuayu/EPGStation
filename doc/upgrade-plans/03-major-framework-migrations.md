# TypeORM 1.0 / Express 5 / Vue 3 大型移行

## 採用バージョン

- TypeORM 1.0.0
- mysql2 3.22.6 / better-sqlite3 12.11.1
- Express 5.2.1 / @types/express 5.0.6
- Vue 3.5.40 / Vue Router 5.0.7
- Vuetify 4.1.5
- Vite 8.1.5 / @vitejs/plugin-vue 6.0.7
- vue-facing-decorator 3.0.4
- vue-tsc 3.2.6 / TypeScript 5.9.2

## 実装内容

### TypeORM

- `sqlite3` を `better-sqlite3`、`mysql` を `mysql2` に置換した。
- DataSource の SQLite driver を `better-sqlite3` に変更した。
- SQLite 拡張のロードを同期 API に合わせた。
- 公開設定値 `dbtype: sqlite/mysql` と既存 migration は維持した。

### Express

- Express 5 と型定義を更新した。
- `body-parser` を削除し、`express.json()` / `express.text()` に移行した。
- Express 5 で削除された `express.static.mime` の変更処理を削除した。

### Vue / Vuetify

- Vue CLI を Vite 8 に置換した。
- `new Vue`、Vue Router 3、Vuetify 2 の起動 API を Vue 3 向けに変更した。
- 100 個のクラスコンポーネントを `vue-facing-decorator` に移行した。
- Vue 2 の lifecycle、`.sync`、scoped slot、`$set` を Vue 3 形式へ変更した。
- Vuetify 2 の削除コンポーネント、activator slot、variant、density、テーマ API を Vuetify 4 形式へ変更した。
- Vuetify 2 専用日時 picker を、`datetime-local` を利用する互換コンポーネントへ置換した。

## 検証状況

実施済み:

- JSON 構文検証
- `git diff --check`
- Vue 2 / Vuetify 2 の主要な旧 API の残存検索
- Express 5 で削除された API と危険な route pattern の検索
- TypeORM driver と依存の整合性確認

実行環境で必要:

- npm install と lockfile 生成
- `npm run compile` / client build / Windows build
- SQLite 既存 DB、SQLite extension、MySQL 接続と migration
- Express OpenAPI 全 endpoint と静的 MIME の確認
- Vue 全画面、動画、字幕、PWA、日時入力、テーマ切替の手動確認

npm レジストリ CLI にはアクセスせず、公式リリース、公式移行ガイド、npm Web ページを根拠にした。TypeScript 7 は Vue の template type checker が依存する compiler API の互換性が確立していないため、5.9.2を維持した。
