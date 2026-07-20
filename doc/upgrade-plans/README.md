# 依存パッケージ大型アップデート計画 (AI 作業指示書)

EPGStation (stuayu フォーク) の依存を最新メジャーへ更新するための作業指示書集。
各ファイルを 1 つの AI エージェントへの独立した指示 (プロンプト) としてそのまま渡せる形式で書いてある。

## 実施順序 (厳守)

1. [01-typeorm-1x.md](01-typeorm-1x.md) — TypeORM 0.3 → 1.x (CommonJS のまま実施。DB 互換を単独で検証するため最初にやる)
2. [02-server-esm-majors.md](02-server-esm-majors.md) — サーバの ESM 化 + 残り依存のメジャー更新 (express 5, inversify 8 など)
3. [03-client-vue3.md](03-client-vue3.md) — クライアントの Vue 3 + Vuetify 最新 + Vite 移行

各ステップは**完了・検証・コミットしてから**次に進むこと。並行実施しない (同じファイル群を触るため)。

## 全ステップ共通の前提・制約

- リポジトリ: https://github.com/stuayu/EPGStation (作業対象はローカルの main ブランチ)
- `CLAUDE.md` と `doc/PROJECT_OVERVIEW.md` を必ず先に読むこと (アーキテクチャ・規約・ドキュメント更新ルール)
- **`mirakurun` 依存は `stuayu/Mirakurun` のコミット固定。絶対にバージョンを変えない**
- `aribts` は npm の latest タグが古いバージョンを指しているため更新対象外
- **テストは存在しない**。検証は「型チェック/ビルド成功 + サーバ起動確認 + 手動確認」で行う
- Windows 対応が本フォークの柱。パス処理 (`path.join`)、Mirakurun の named pipe 接続、`npm run build-win` / `config-win.yml.template` を壊さない
- CI は `.github/workflows/build-validation.yml` で 3 OS (ubuntu/windows/macos) × Node 24 を検証している。Node 24 LTS方針を変更する場合はこのワークフローと `package.json` の `engines`、`Dockerfile.alpine` / `Dockerfile.debian` も更新する
- コミットメッセージは日本語で `Fix:` / `Add:` / `Update:` プレフィックス
- コード変更したら `doc/stuayu-fork.md` の「変更箇所」等のドキュメント更新が必須 (CLAUDE.md のルール参照)
- ルートに package-lock.json を置かない運用だったが、依存ドリフト事故防止のため**この一連の作業からは lockfile をコミットする方針に切り替えて良い** (切り替える場合は README 等にその旨を記載)
