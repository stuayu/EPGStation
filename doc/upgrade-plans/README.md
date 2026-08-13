# 依存パッケージ大型アップデート計画 (AI 作業指示書)

> [!NOTE]
> **これは実施済みの作業指示書 (歴史的資料) で、現在の手順書ではない。**
> ここに書かれた移行 (TypeORM 1.x / Express 5 / Vue 3 + Vuetify 4 + Vite) はすべて完了している。
> 現在のアーキテクチャは [../PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md)、作業ルールは [../../CLAUDE.md](../../CLAUDE.md) を見ること。
> 当時の前提 (「テストは存在しない」など) は今の実態と異なる (現在は `test/ut` `test/ita` `test/itb` がある)。

EPGStation (stuayu フォーク) の依存を最新メジャーへ更新するための作業指示書集。
各ファイルを 1 つの AI エージェントへの独立した指示 (プロンプト) としてそのまま渡せる形式で書いてある。

## 収録されている指示書 (実施順)

1. [01-typeorm-1x.md](01-typeorm-1x.md) — TypeORM 0.3 → 1.x (DB 互換を単独で検証するため最初に実施)
2. [03-major-framework-migrations.md](03-major-framework-migrations.md) — サーバの依存メジャー更新 (express 5 など) とクライアントの Vue 3 + Vuetify + Vite 移行
3. [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) — 実施結果の報告

いずれも実施済み。

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
- コード変更したら `doc/changelog-fork.md` の「変更箇所」等のドキュメント更新が必須 (CLAUDE.md のルール参照)
- ルートに package-lock.json を置かない運用だったが、依存ドリフト事故防止のため**この一連の作業からは lockfile をコミットする方針に切り替えて良い** (切り替える場合は README 等にその旨を記載)
