# ドキュメント一覧

EPGStation (stuayu フォーク) のドキュメントの入口。**目的から探す**ようにできている。

## 使う人向け

| やりたいこと | 読むもの |
| --- | --- |
| Windows で動かす | [windows-setup.md](windows-setup.md) (フォーク版 Mirakurun の導入手順を含む) |
| Linux で動かす | [linux-setup.md](linux-setup.md) / [linux-nginx.md](linux-nginx.md) (リバースプロキシ) |
| 設定を変える | [conf-manual.md](conf-manual.md) — `config.yml` の全項目マニュアル |
| ログ設定を変える | [log-manual.md](log-manual.md) |
| WebAPI を叩く | [webapi.md](webapi.md) — 一覧は Swagger UI (`/api/debug`) にある |
| どんな画面があるか見る | [screenshots.md](screenshots.md) |
| 字幕・低遅延の設定を詰める | [caption-lowlatency-setup.md](caption-lowlatency-setup.md) |
| Kodi と連携する | [kodi.md](kodi.md) |
| URL スキームで外部プレイヤーを開く | [mac-url-scheme.md](mac-url-scheme.md) / [windows-url-scheme.md](windows-url-scheme.md) |
| v1 から移行する | [v1migrate.md](v1migrate.md) |
| sqlite3 で正規表現検索を使う | [sqlite3-regexp.md](sqlite3-regexp.md) |

## 開発する人・AI エージェント向け

**この順で読む。**

1. [../CLAUDE.md](../CLAUDE.md) — 作業ルール、コマンド、コーディング規約、**踏むと壊れるところ**
2. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) — アーキテクチャ (2 プロセス構成 / DI / ディレクトリ)、主要機能の実装場所、注意点。**現在の仕様はここ**
3. 触る領域のドキュメント (下表)

| 触る領域 | 読むもの |
| --- | --- |
| ライブ/録画配信・エンコード・プレイヤー | [streaming-refresh.md](streaming-refresh.md) |
| 設定項目の追加・変更 | [conf-manual.md](conf-manual.md) |
| API の追加・変更 | ルートの `api.yml` (OpenAPI 定義が仕様の正) |
| テストの書き方・方針 | [testing.md](testing.md) |
| **ある機能がなぜそうなっているのか** | [changelog-fork.md](changelog-fork.md) — 変更ログ。索引から目的の項目を検索して読む |

### 決まった作業には Skill がある

`.claude/skills/` に手順書がある。該当する作業では**必ず使う** (手順の抜けがそのまま不具合になる領域を選んである)。

| Skill | 使うとき |
| --- | --- |
| `add-api-endpoint` | WebAPI エンドポイントを追加・変更する |
| `add-client-page` | Web UI にページやコンポーネントを追加する |
| `add-config-option` | `config.yml` の設定項目を追加する |
| `db-migration` | DB スキーマを変更する |
| `write-tests` | テストを追加する |

## 履歴・過去の資料

| ドキュメント | 内容 |
| --- | --- |
| [changelog-fork.md](changelog-fork.md) | フォークの変更ログ (新しい順、カテゴリ別索引つき) |
| [upgrade-plans/](upgrade-plans/) | 依存の大型アップデート計画。**実施済みの資料**で、現在の手順書ではない |
| [mysql-mirakurun-3.9.0-beta.24.md](mysql-mirakurun-3.9.0-beta.24.md) | 古い Mirakurun と MySQL の組み合わせに関する記録 |

## ドキュメントの役割分担

同じことを 2 箇所に書かないための決まり。

- **CLAUDE.md** — 作業ルールと地雷。全セッションで自動読み込みされるので**短く保つ**
- **PROJECT_OVERVIEW.md** — 「今どうなっているか」。同じく自動読み込み。詳細は各ドキュメントへ委譲する
- **changelog-fork.md** — 「なぜそうなったか」。履歴なので追記のみ、書き換えない
- **conf-manual.md / streaming-refresh.md / webapi.md** — 領域ごとの詳細仕様
- **setup 系** — 利用者向けの手順

コードを変更したら、同じ作業の中で該当ドキュメントも更新する (ルールは [../CLAUDE.md](../CLAUDE.md) を参照)。
