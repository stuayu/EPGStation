# EPGStation (stuayu フォーク版)

| ブランチ | 状態                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| main     | [![build](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml/badge.svg?branch=main)](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml) |
| test     | [![build](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml/badge.svg?branch=test)](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml) |

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフト [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) のフォーク版です。
モバイルフレンドリーな Web インターフェイスはそのままに、**Windows 完全対応**・**県外地上波 (NW1〜NW40)**・**シリーズ管理**などを追加しています。

> [!NOTE]
> 本フォークは[フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun) と組み合わせて動作させることを前提としています。
> 本家 Mirakurun や mirakc での動作は保証しません。

- ドキュメント一覧: [doc/README.md](doc/README.md)
- 変更の経緯: [doc/changelog-fork.md](doc/changelog-fork.md)

## 機能

### 番組の視聴・録画・管理 (上流から引き継ぐ基本機能)

- 番組表の表示・番組検索
- 予約
    - 番組表からの手動予約、ルールによる自動予約
    - 予約の競合・重複の警告
- 視聴
    - 放送中番組のライブ視聴、録画済み番組のストリーミング視聴・ダウンロード
    - [aribb24.js][] による字幕 / 文字スーパー表示
    - [mpegts.js][] による[低遅延ライブ視聴](doc/caption-lowlatency-setup.md)
- エンコード、ドロップチェック、外部コマンド連携
- WebAPI ([doc/webapi.md](doc/webapi.md)。全 API は `/api/debug` の Swagger UI で確認できます)

### フォーク版の拡張

- **Windows 完全対応** — named pipe 接続、Windows サービス化、セットアップマニュアル
- **県外地上波対応** — チャンネル種別 `NW1`〜`NW40` を追加。新4K8K衛星放送 (`BS4K` / `CS4K`) にも対応
- **Mirakurun への HTTPS 接続** — `mirakurunPath: https://...`。API のベースパスも `mirakurunAPIPath` で変更可能
- **シリーズ管理** — 録画をシリーズ単位でまとめ、しょぼいカレンダー / Annict / Wikidata の作品辞書で自動マッピング。話数・サブタイトル・放送種別 (初回 / 再放送 / 遅れ放送) の判定、欠番・重複・未視聴のバッジ、アイキャッチ画像、未確定キューからの手動割り当てに対応
- **EPG のリアルタイム追従** — 災害時の特番割り込みや前番組の延長を待たずに DB へ反映し、視聴画面・番組表・予約が即座に追随します。前番組の延長中に録画を始めてしまわないよう EIT[p/f] を見て開始を待つ機能も入っています
- **テレビ風の視聴画面** — ライブ / 録画とも全画面レイアウト。番組情報・チャンネル・次の話・実況コメントを右パネルに表示
- **ニコニコ実況コメントの弾幕表示** — ライブは [NX-Jikkyo](https://nx-jikkyo.tsukumijima.net)、録画は[過去ログ API](https://jikkyo.tsukumijima.net) から取得。放送波の時刻 (TDT / TOT) で遅延を補正します
- **データ放送 (BML) 対応** — [tsukumijima/web-bml](https://github.com/tsukumijima/web-bml) で BML を描画 (映像は引き続き DPlayer が再生)。既定は無効
- **録画ファイルの TS 解析** — 取り込み・アップロードした TS から放送局・番組情報・映像音声情報を復元します
- **放送局の系列表示** — 日テレ系・TBS 系などで番組表と放映中をグルーピングできます (`/affiliations`)
- **サーバー設定画面** — `config.yml` の主要項目を Web UI から変更。外部サービス連携、ログレベル、録画ファイルの一括解析、シリーズ照合ルールの管理を含みます
- **更新通知とワンクリック更新** — GitHub Releases を定期確認し、リリース版・開発版のどちらへも画面から更新できます
- **ログイン認証と権限管理** — パスワード認証と SSO (Google / GitHub)。既定は無効
- **ログ閲覧画面** — `/logs` でプロセス / カテゴリ別にログを閲覧・絞り込み・ダウンロードできます
- **視聴履歴** — 続きから再生、視聴済み管理
- **依存関係のモダナイズ**
    - フロントエンド: Vue 3 + Vuetify 4、ビルドは Vite
    - 動画プレイヤー: [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer)
    - サーバ: Node.js 24 / Express 5 / TypeORM 1.x / better-sqlite3

[aribb24.js]: https://github.com/monyone/aribb24.js
[mpegts.js]: https://github.com/xqq/mpegts.js

## 画面

| シリーズ一覧                                                                        | シリーズ詳細                                                                            | シリーズ未確定キュー                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [![シリーズ一覧](img/screenshots/series-list.png)](img/screenshots/series-list.png) | [![シリーズ詳細](img/screenshots/series-detail.png)](img/screenshots/series-detail.png) | [![シリーズ未確定キュー](img/screenshots/series-pending.png)](img/screenshots/series-pending.png) |

| サーバー設定 (基本)                                                                                            | サーバー設定 (連携)                                                                                                        | サーバー設定 (シリーズ管理)                                                                                              | サーバー設定 (更新)                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [![サーバー設定 (基本)](img/screenshots/system-settings-basic.png)](img/screenshots/system-settings-basic.png) | [![サーバー設定 (連携)](img/screenshots/system-settings-integration.png)](img/screenshots/system-settings-integration.png) | [![サーバー設定 (シリーズ管理)](img/screenshots/system-settings-series.png)](img/screenshots/system-settings-series.png) | [![サーバー設定 (更新)](img/screenshots/system-settings-update.png)](img/screenshots/system-settings-update.png) |

各画面の説明は [doc/screenshots.md](doc/screenshots.md) を参照してください。

## 動作環境

- Linux / macOS / Windows
- [Node.js](http://nodejs.org/) 24.x (npm 11.x)
- [フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun)
    - HTTP / HTTPS / unix socket / named pipe (Windows) での接続に対応
    - 本家 [Mirakurun](https://github.com/Chinachu/Mirakurun) や [mirakc](https://github.com/mirakc/mirakc) での動作は保証しません
- いずれかのデータベース
    - [SQLite3](https://www.sqlite.org/) — 設定不要。検索機能に制限あり [標準]
        - [SQLite3 使用時の正規表現での検索の有効化について](doc/sqlite3-regexp.md)
    - [MySQL](https://www.mysql.com/jp/) / [MariaDB](https://mariadb.org/) — 推奨 (要設定)。文字コードは utf8mb4
        - [Mirakurun 3.9.0-beta.24 以降の設定について](doc/mysql-mirakurun-3.9.0-beta.24.md)
    - PostgreSQL は未対応
- [FFmpeg](http://ffmpeg.org/) (FFprobe を含む)

SQLite ドライバ ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) のインストール時にビルド済みバイナリを取得できなかった場合は、次の環境も必要です。

- Linux / macOS: [Python 3.x](https://www.python.org/) と [GCC](https://gcc.gnu.org/) (node-gyp が使用)
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/ja/downloads/) (node-gyp が使用)

## セットアップ

| 環境 | マニュアル |
| --- | --- |
| Windows | [doc/windows-setup.md](doc/windows-setup.md) (フォーク版 Mirakurun の導入手順を含む) |
| Linux / macOS | [doc/linux-setup.md](doc/linux-setup.md) |
| 字幕表示 / 低遅延配信 | [doc/caption-lowlatency-setup.md](doc/caption-lowlatency-setup.md) |

インストールとビルドの最小手順:

```bash
git clone https://github.com/stuayu/EPGStation.git -b main
cd EPGStation
npm run all-install
npm run build         # Windows は npm run build-win
npm start
```

Windows でサービスとして常駐させる場合は `npm run install-win-service` (管理者権限)。
状況確認は `npm run status-win-service`、解除は `npm run uninstall-win-service` です。

設定は `config/config.yml` を編集します (無い場合はテンプレートから起動時に自動生成されます)。
全項目の説明は [doc/conf-manual.md](doc/conf-manual.md) にあります。

### Docker

タグを打つたびに `ghcr.io/stuayu/epgstation` へマルチアーキテクチャのイメージを公開しています。
`latest` / `<バージョン>` は Debian ベース、`alpine` サフィックス付きは Alpine ベースです
(Dockerfile は `Dockerfile.debian` / `Dockerfile.alpine`)。

## アップデート

### Web UI から更新する (推奨)

サーバー設定画面の「更新」タブから、リリース版 (タグ) と開発版 (`main` の最新コミット) のどちらへも
ワンクリックで更新できます。更新後の再起動はサービス管理 (systemd / docker / pm2 / Windows サービス) に委ねます。
git clone した環境でのみ利用できます。

### 手動で更新する

```bash
git pull
npm run all-install
npm run build         # Windows は npm run build-win
```

実行後に EPGStation を再起動してください。

## 動作確認

- ブラウザから `http://<IPアドレス>:<ポート>/` にアクセスする
- API を直接叩く

    ```bash
    curl -o - http://<IPアドレス>:<ポート>/api/config
    ```

### ログ

Web UI の `/logs` ページから、各プロセスのログを閲覧・絞り込み・ダウンロードできます (SSH ログイン不要)。
ファイルは `logs/{EPGUpdater,Operator,Service}/` に出力されます。

| プロセス | 主なログ |
| --- | --- |
| EPGUpdater | `system.log` — Mirakurun へのアクセス、番組情報の更新 |
| Operator | `system.log` — 録画、予約の追従、コマンド実行 |
| Service | `access.log` (Web アクセス) / `stream.log` (配信) / `encode.log` (エンコード) / `system.log` |

出力レベルなどの詳細設定は [doc/log-manual.md](doc/log-manual.md) を参照してください。

## データベースのバックアップとレストア

予約情報・録画済み番組情報・録画履歴・録画予約ルールをバックアップできます。
バックアップデータはデータベースに依存しないため、MySQL でバックアップして SQLite3 へレストアすることも可能です。

```bash
npm run backup FILENAME     # バックアップ
npm run restore FILENAME    # レストア (config.yml に新しい DB 設定を書いてから実行する)
```

> [!IMPORTANT]
> 録画ファイル (recorded) / サムネイル (thumbnail) / ドロップログ (drop) / ログ (logs) / 設定ファイル (config.yml)
> は**バックアップに含まれません**。別途手動でバックアップしてください。
>
> 本家 EPGStation から移行する場合、**ルール予約のバックアップだけは互換性がありません**
> (本フォークは `NW1`〜`NW40` を追加しているため)。手順は [doc/windows-setup.md](doc/windows-setup.md) を参照してください。

v1 からの移行は [doc/v1migrate.md](doc/v1migrate.md) を参照してください。

## クライアント向け設定

### URL Scheme

EPGStation 上の動画再生を OS 上のアプリケーションで行えます。

- [config.yml 内の設定 (iOS, Android, macOS, Windows)](doc/conf-manual.md#urlscheme)
- [macOS 用の URL Scheme 設定方法](doc/mac-url-scheme.md)
- [Windows 用の URL Scheme 設定方法](doc/windows-url-scheme.md)

上記以外の環境では、Web UI の設定画面から各ブラウザごとに設定してください。
スマートフォンでは config.yml で指定したアプリをインストールしておく必要があります。

## Tips

### Kodi との連携

[Kodi](https://kodi.tv/) との連携に対応しています。詳細は [doc/kodi.md](doc/kodi.md) を参照してください。

### リバースプロキシ

nginx を使う場合の設定例は [doc/linux-nginx.md](doc/linux-nginx.md) にあります。

### Android 6.0 以上での注意

Android の 設定 → ユーザー補助 で "操作の監視" が必要なサービス (LMT Launcher, Pie Control など) を ON にしていると、
番組表の動作が著しく重くなります。該当サービスを OFF にするか、Firefox での使用を試してください。

## 開発者向け

- 全体像の図: [doc/architecture.md](doc/architecture.md)
- アーキテクチャと実装場所: [doc/PROJECT_OVERVIEW.md](doc/PROJECT_OVERVIEW.md)
- 作業ルール・コーディング規約・注意点: [CLAUDE.md](CLAUDE.md)
- テスト方針: [doc/testing.md](doc/testing.md)

```bash
npm run compile   # サーバの型チェック
npm test          # 単体 + 結合テスト
npm run lint      # eslint --fix
```

## Contributing

[CONTRIBUTING.md](.github/CONTRIBUTING.md)

## Licence

[MIT Licence](LICENSE)
