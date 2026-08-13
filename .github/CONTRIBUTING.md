# コントリビュートガイド

EPGStation (stuayu フォーク) への貢献を歓迎します。
バグ報告・要望・プルリクエストのいずれも、下の内容に沿っていただけると対応が早くなります。

> [!NOTE]
> 本フォークは[フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun) と
> 組み合わせて動かすことを前提としています。本家 Mirakurun や mirakc 固有の問題は対応できないことがあります。
> 上流 [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) 由来の不具合は、上流へ報告いただいた方が早い場合があります。

## バグの報告

[Issue](https://github.com/stuayu/EPGStation/issues) を作成してください。次の情報があると原因を特定しやすくなります。

- **環境** — EPGStation / Mirakurun (フォーク版か本家か) / Node.js のバージョン、OS、使用している DB (SQLite / MySQL)
- **再現手順** — 何をしたら起きるか
- **期待した動作と実際の動作**
- **ログ** — `logs/{Operator,Service,EPGUpdater}/system.log` の該当時刻の前後。Web UI の `/logs` ページからも取得できます
- 画面の問題であればスクリーンショットとブラウザ名

> [!IMPORTANT]
> ログや設定ファイルを貼るときは、**アクセストークン・パスワード・SSO のクライアントシークレット・
> 外部に出したくない IP アドレスやパス**をマスクしてください。

## 要望・提案

決まったフォーマットはありません。**何をしたいか (目的)** と **今はどう困っているか** が分かるように書いてください。
実現方法の案がある場合は併せて書いていただけると助かります。

## プルリクエスト

### ブランチ

- **`main` から切って、`main` に対して PR を出してください** (上流の `v2` / `master` 運用ではありません)
- ブランチ名は `feature/<内容>` または `fix/<内容>` を推奨します

### 開発の準備

```bash
npm run all-install          # サーバ + クライアントの依存インストール
npm run build                # Windows は npm run build-win
npm start
```

環境構築の詳細は [doc/windows-setup.md](../doc/windows-setup.md) / [doc/linux-setup.md](../doc/linux-setup.md) を参照してください。

### 実装するときに読むもの

| ドキュメント | 内容 |
| --- | --- |
| [doc/README.md](../doc/README.md) | ドキュメントの一覧 |
| [doc/PROJECT_OVERVIEW.md](../doc/PROJECT_OVERVIEW.md) | アーキテクチャ、主要機能の実装場所、注意点 |
| [doc/architecture.md](../doc/architecture.md) | 全体像の図 |
| [CLAUDE.md](../CLAUDE.md) | コーディング規約と「踏むと壊れるところ」 |

コードの決まりごと (抜粋):

- DI 対象は `IXxx.ts` (インターフェース) + `Xxx.ts` (実装) のペアで作り、`ModelContainerSetter.ts` へ登録する
- クラス名 = ファイル名。public メソッドには日本語の JSDoc 風コメントを付ける
- 対応 DB は SQLite / MySQL。マイグレーションは**両方**用意する
- Windows での動作 (パス区切り、named pipe) を壊さない

### 提出前の確認

```bash
npm run lint      # eslint --fix (src/)
npm run format    # prettier (src/)
npm test          # 単体 + 結合テスト。必ず通してください
cd client && npm run build   # クライアントを変更した場合の型チェック
```

- **新機能・不具合修正にはテストを追加してください**。単体テストには行カバレッジ 80% のゲートがあります
- 不具合修正では、**先に再現するテストを書く**と回帰を防げます
- 挙動やアーキテクチャが変わる変更は、同じ PR で該当ドキュメントも更新してください (更新先は [CLAUDE.md](../CLAUDE.md) の「ドキュメント更新ルール」にまとめてあります)

### コミットメッセージ

日本語で、既存の履歴に合わせて次のプレフィックスを付けてください。

```text
Fix: 〜を直した
Add: 〜を追加した
Update: 〜を更新した
```

件名で「何をしたか」が分かるようにし、背景や判断理由は本文に書いてください。

### レビュー

CI (3 OS × Node 24 のビルド検証) が通ることを確認してください。
指摘は改善のためのものです。意図や制約があれば遠慮なく返信してください。

## ライセンス

コントリビュートされた内容は [MIT License](../LICENSE) の下で公開されます。
