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
