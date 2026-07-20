# 依存最新化 実装レポート

大型移行を機能単位でコミットした。

- TypeORM 1.0: `b3df6c2a`
- Express 5: `10fc954e`
- Vue 3 / Vite 8 基盤: `2053c62a`
- Vuetify 4 component API: `33fe772e`
- Vuetify 4 theme/event API: `09ec3410`

Web で公式資料を確認しながら実装した。パッケージ取得不能環境のため、依存インストールを伴う compile/build/runtime test は後続検証項目として明記している。

## アップロード版との統合

アップロード版の `ac7c5896 Fix: クリーンアップ処理の安全性を高めるように修正` を保持したまま大型移行を統合した。`RecordedCleanupDialog.vue` の競合は、安全性強化側の機能を維持し、Vuetify 4 の構文だけを適用して解消した。

## 追加レビュー対応

- VueテーマAPIの構文破損とViteエントリ配置を修正。
- Node.js 24 LTS、ES2023、CI、Docker、Multer 2へ統一。
- TypeORMの公開型、null/undefined WHERE拒否、Express 5の静的MIMEを追加。
- Docker Actions、Buildx cache、GITHUB_OUTPUTを最新形式へ変更。
- Vue Router guardをcomponent optionへ明示登録し、Router 5の公開型へ移行。
- Vuetify 2のmenu、theme CSS、検索モデル、時刻dialog、旧propsを置換。

lockfile生成、依存インストールを伴う完全な型検査、DB・Docker・全画面の実行試験はnpmアクセス可能環境で実施する。

## 型安全性レビュー

型検査を無効化する `@ts-ignore` / `@ts-nocheck` は存在しなかった。一方で、外部入力と汎用ストレージを中心に `any` が使われていたため、次を具体化した。

- Vue Router component guard の `this` を各component classとして明示。
- Vue 2時代のSFC/TSX shimと空のmodule宣言を削除し、Vue 3の`DefineComponent`宣言へ更新。
- 日付formatter、query map、HTTP response headerを`Record`型へ変更。
- better-sqlite3 driver境界、aribts selector option、package metadataをinterface/type guardで定義。
- Express upload request/responseとOpenAPI errorを`unknown`から検証。
- Web Storageをgeneric API、scroll historyを`unknown` + runtime shape checkへ変更。
- API handlerのcatch値を`unknown`へ変更し、共通の安全なmessage変換を利用。

残存する`any`は、生成API定義、動的DB update object、IPCの可変payload、外部ライブラリの不足型、未検証JSON/configなどが中心である。これらは単純な型assertionへ置換せず、実行時schema validationまたはdiscriminated unionを導入してから段階的に除去する。
