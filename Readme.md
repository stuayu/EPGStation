# EPGStation (stuayu フォーク版)

| ブランチ | 状態 |
|---|---|
| main | [![build](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml/badge.svg?branch=main)](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml) |
| test | [![build](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml/badge.svg?branch=test)](https://github.com/stuayu/EPGStation/actions/workflows/build-validation.yml) |

[l3tnun/EPGStation](https://github.com/l3tnun/EPGStation) のフォーク版です。フォーク版の機能詳細は [doc/stuayu-fork.md](doc/stuayu-fork.md) をご覧ください。

> [!NOTE]
> 本フォークは[フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun) と組み合わせて動作させることを前提としています。
> 本家 Mirakurun や mirakc での動作は保証しません。

## フォーク版の主な拡張

- **Windows 完全対応** (named pipe 接続、Windows サービス化、セットアップマニュアル)
- **県外地上波対応** (チャンネル種別 `NW1`〜`NW40` の追加)
- **Mirakurun への HTTPS 接続対応** (`mirakurunPath: https://...` を指定可能。API エンドポイントのベースパスも `mirakurunAPIPath` で変更可能)
- **依存関係のモダナイズ**
  - フロントエンドを Vue 3 + Vuetify 4 へ更新し、ビルドを Vue CLI から Vite へ移行
  - 動画プレイヤーを [DPlayer (tsukumijima フォーク)](https://github.com/tsukumijima/DPlayer) v1.32.8 へ更新
  - サーバ側を Node.js 24 / Express 5 / TypeORM 1.0 / better-sqlite3 へ更新

### インストールとビルド方法

- Windows
  - `npm run all-install && npm run build-win`
  - `npm run install-win-service` (Windows サービスとして登録する場合)
- Linux / macOS
  - `npm run all-install && npm run build`

以下オリジナル
---

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフトです  
iOS・Android での閲覧に最適化されたモバイルフレンドリーな Web インターフェイスが特徴です  
PC からの閲覧でもモダンな UI で操作可能です

## 機能

### 放送番組の視聴・録画・管理

-   ブラウザでの Web インターフェイス操作
    -   番組表の表示
    -   番組検索
    -   番組単位の予約
        -   番組表からの手動予約
        -   ルールによる自動予約
        -   予約の競合や重複の警告
    -   番組の視聴
        -   放送中番組のライブ視聴
        -   [aribb24.js][] を使用する Web での字幕/文字スーパー表示機能
        -   [mpegts.js][] を使用する Web での[低遅延ライブ視聴機能](doc/caption-lowlatency-setup.md)
        -   録画済み番組のストリーミング視聴
        -   録画済み番組のダウンロード
-   API
    -   [WebAPI Document](doc/webapi.md)

[aribb24.js]: https://github.com/monyone/aribb24.js
[mpegts.js]: https://github.com/xqq/mpegts.js

## スクリーンショット

| ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/dashboard.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/live.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/program.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/recording.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/recorded.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/reserves.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/rule.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/search.png) |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |

---

## デモ

![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/demo.gif)

## 動作環境

-   Linux / macOS / Windows
-   [Node.js](http://nodejs.org/) : 24.x (npm 11.x)
-   [フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun)
    -   HTTP / HTTPS / unix socket / named pipe (Windows) での接続に対応
    -   本家 [Mirakurun](https://github.com/Chinachu/Mirakurun) や [mirakc](https://github.com/mirakc/mirakc) での動作は保証しません
-   いずれかのデータベース
    -   [SQLite3](https://www.sqlite.org/)（設定不要だが検索機能に制限あり）[標準]
        -   [SQLite3 使用時の正規表現での検索の有効化について](doc/sqlite3-regexp.md)
    -   [MySQL](https://www.mysql.com/jp/) ([MariaDB](https://mariadb.org/))【推奨(要設定)】※文字コードは utf8mb4
        -   [Mirakurun 3.9.0-beta.24 以降の設定について](doc/mysql-mirakurun-3.9.0-beta.24.md)
    -   ~~[PostgreSQL](https://www.postgresql.org/)~~ (未対応)
-   [FFmpeg](http://ffmpeg.org/)

SQLite ドライバ ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) のインストール時にビルド済みバイナリが取得できなかった場合は次の環境も必要

-   for Linux / macOS
    -   [Python v3.x](https://www.python.org/) node-gyp にて必要
    -   [GCC](https://gcc.gnu.org/) node-gyp にて必要
-   for Windows
    -   [Visual Studio Build Tools](https://visualstudio.microsoft.com/ja/downloads/) node-gyp にて必要

---

## セットアップ方法

### [Linux / macOS 用セットアップマニュアル](doc/linux-setup.md)

### [Windows 用セットアップマニュアル](doc/windows-setup.md)

### [字幕表示 / 低遅延配信用セットアップマニュアル](doc/caption-lowlatency-setup.md)

---

## アップデート方法

-   以下のコマンドを実行後に EPGStation を再起動する

    ```
    $ git pull
    $ npm run all-install
    $ npm run build        # Windows は npm run build-win
    ```

---

## v1 からの移行について

[doc/v1migrate.md](doc/v1migrate.md) を参照

---

## 動作確認

-   ブラウザから `http://<IPaddress>:<Port>/` にアクセスをする
-   curl や wget で API を叩く

    ```
    $ curl -o - http://<IPaddress>:<Port>/api/config
    ```

### ログの確認

#### [ログ出力の詳細設定](doc/log-manual.md)

#### logs/EPGUpdater

-   EPG 更新機能からのログが記録されています
    -   `access.log`
        -   基本的に空ファイル
    -   `stream.log`
        -   基本的に空ファイル
    -   `system.log`
        -   Mirakurun へのアクセスログ、番組情報の更新等のログ

#### EPGStation/logs/Operator

-   録画管理機能からのログが記録されています
    -   `access.log`
        -   基本的に空ファイル
    -   `stream.log`
        -   基本的に空ファイル
    -   `system.log`
        -   Mirakurun へのアクセスログ、コマンドの実行、録画等のログ

#### EPGStation/logs/Service

-   Web インターフェイスからのログ記録されています
    -   `access.log`
        -   Web インターフェイスへのアクセスログ
    -   `stream.log`
        -   ストリーミング配信ログ
    -   `system.log`
        -   Web サーバの動作ログ
    -   `encode.log`
        -   エンコード処理関連のログ

---

## クライアント向け設定

-   EPGStation を利用する端末向けの設定を行うと快適に利用可能です

### URL Scheme

-   EPGStation 上の動画再生を OS 上のアプリケーションで行うことが出来ます

    -   [config.yml 内の設定 (iOS, Android, macOS, Windows)](doc/conf-manual.md#urlscheme)
    -   [macOS 用の URL Scheme 設定方法](doc/mac-url-scheme.md)
    -   [Windows 用の URL Scheme 設定方法](doc/windows-url-scheme.md)

-   上記以外の環境での設定は WebUI の設定で各ブラウザごとに設定してください

### スマートフォン側の設定

config.yml で設定したアプリをインストールしてください

---

## データベースのバックアップとレストア

データベースに含まれる以下の情報がバックアップ可能です

-   予約情報
-   録画済み番組情報
-   録画履歴
-   録画予約ルール

バックアップデータはデータベースに依存しないので MySQL でバックアップし、SQLite3 へレストアなども可能です

### 注意

以下のファイルとディレクトリはバックアップに含まれません  
別途手動でバックアップしてください

-   録画ファイル (recorded)
-   サムネイル (thumbnail)
-   ドロップログ (drop)
-   ログ (logs)
-   設定ファイル (config.yml)

### バックアップ

-   以下のコマンドを実行

```
npm run backup FILENAME
```

### レストア

-   config.yml に新しいデータベース設定を記述後に以下のコマンドを実行

```
npm run restore FILENAME
```

---

## Tips

### Kodi との連携

[Kodi](https://kodi.tv/) との連携に対応しています詳細は [doc/kodi.md](doc/kodi.md) を参照してください

### Android 6.0 以上での注意

Android の設定 -> ユーザー補助 にて "操作の監視" が必要なサービスを ON にしていると、番組表の動作が著しく重くなります  
具体的なアプリは LMT Launcher や Pie Control などが挙げられます

該当サービスを OFF にするのが一番良いですが、それができない場合は Firefox での使用を試してみてください。

## Contributing

[CONTRIBUTING.md](.github/CONTRIBUTING.md)

## Licence

[MIT Licence](LICENSE)
