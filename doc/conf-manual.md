# config.yml 詳細マニュアル

## コンフィグ逆引きレシピ

- [基本設定](#基本設定)
    - [EPGStation の待ち受けポートを変えたい](#port)
    - [EPGStation の Socket.IO 待ち受けポートを変えたい](#socketioport)
    - [クライアントが接続に使用する Socket.IO ポートを変えたい](#clientsocketioport)
    - [Mirakurun の設定](#mirakurunpath)
    - [データベースの種類を変えたい](#dbtype)
    - [MySQL の設定を変更したい](#mysql)
    - [SQLite3 の設定を変更したい](#sqlite)
    - [利用する FFmpeg を明示的に指定したい](#ffmpeg)
    - [利用する FFprobe を明示的に指定したい](#ffprobe)
    - [tsreadex で TS を前処理したい](#tsreadex)
    - [QSVEncC / NVEncC / VCEEncC のパスを指定したい](#qsvencc)
- [stuayu フォーク独自の設定](#stuayu-フォーク独自の設定)
    - [ログイン認証・SSO を有効にしたい](#auth)
    - [番組延長で録画開始が遅れる場合の待ち時間を変えたい](#recording)
    - [機能ごとの有効・無効を切り替えたい](#featureflags)
    - [シリーズ名の抽出に LLM を使いたい](#seriesllm)
    - [新しいバージョンの公開を知りたい](#updatechecker)
    - [CM カット・ロゴ消しを Amatsukaze に任せたい](#amatsukaze)
- [詳細設定](#詳細設定)
    - [番組情報の囲み文字の設定を変更したい](#needtoreplaceenclosingcharacters)
    - [録画時の Mirakurun の優先度を変更したい](#recpriority)
    - [録画競合時の Mirakurun の優先度を変更したい](#conflictpriority)
    - [時刻指定予約時の開始マージンを変更したい](#timespecifiedstartmargin)
    - [時刻指定予約時の終了マージンを変更したい](#timespecifiedendmargin)
    - [録画重複の判定期間を延ばしたい](#recordedhistoryretentionperioddays)
    - [番組情報の更新頻度を変更したい](#epgupdateintervaltime)
    - [番組情報更新時のログ出力を抑えたい](#issuppressreservesupdatealllog)
    - [チャンネルの並び順を変更したい](#channelorder)
    - [チャンネルの並び順を変更したい(sid)](#sidorder)
    - [特定のチャンネルは除外したい](#excludechannels)
    - [特定のチャンネルは除外したい(sid)](#excludesids)
    - [自動起動時の GID を指定したい](#gid)
    - [自動起動時の UID を指定したい](#uid)
    - [録画時にドロップチェックを有効化したい](#isenableddropcheck)
    - [ドロップログの保存先を変更したい](#droplog)
    - [アクセス URL の設定をルートではなくサブディレクトリ下に変更したい](#subdirectory)
    - [Swagger UI で使用するサーバリストを変更したい](#apiservers)
    - [CORS ヘッダーをすべて許可したい](#isallowallcors)
- [ファイル保存先](#ファイル保存先)
    - [録画ファイルの保存先を変更したい](#recorded)
    - [一時録画先を設定したい](#recordedtmp)
    - [録画ファイルのファイル名を変更したい](#recordedformat)
    - [録画ファイルの拡張子を変更したい](#recordedfileextension)
    - [空き容量確認頻度を変更したい](#storagelimitcheckintervaltime)
    - [サムネイル画像の保存先を変更したい](#thumbnail)
    - [サムネイル生成コマンドを変更したい](#thumbnailcmd)
    - [サムネイル画像の解像度を変更したい](#thumbnailsize)
    - [サムネイル画像を生成する再生位置を変更したい](#thumbnailposition)
    - [ファイルアップロード時の一時フォルダを変更したい](#uploadtempdir)
- [外部コマンド実行](#外部コマンド実行)
    - [録画予約新規追加時に外部コマンドを実行したい](#reservenewaddtioncommand)
    - [録画予約の更新時に外部コマンドを実行したい](#reserveupdatecommand)
    - [録画予約の削除時に外部コマンドを実行したい](#reservedeletedcommand)
    - [録画準備開始時に外部コマンドを実行したい](#recordingprestartcommand)
    - [録画準備失敗時に外部コマンドを実行したい](#recordingpreprecfailedcommand)
    - [録画開始時に外部コマンドを実行したい](#recordingstartcommand)
    - [録画終了時に外部コマンドを実行したい](#recordingfinishcommand)
    - [録画失敗時に外部コマンドを実行したい](#recordingfailedcommand)
    - [エンコード終了時にコマンドを実行したい](#encodingfinishcommand)
    - [エンコードやストリーミングで使用するプロセス数の上限を変更したい](#encodeprocessnum)
    - [同時にエンコードするプロセス数の上限を更新したい](#concurrentencodenum)
    - [ハードウェアエンコーダ (QSV/VAAPI/NVENC) やコーデック・画質をまとめて有効化したい](#encodepresets)
    - [録画ファイルを自動でエンコードしたい](#encode)
- [視聴設定](#視聴設定)
    - [ライブ視聴時の Mirakurun の優先度を変更したい](#streamingpriority)
    - [視聴アプリを変更したい](#urlscheme)
    - [HLS 配信時の一時ファイルの出力先を変更したい](#streamfilepath)
    - [ストリーミング視聴の設定を変更したい](#stream)
    - [任意の Kodi と連携させたい](#kodihosts)
- [設定の決まり方](#設定の決まり方)
    - [実効値の 3 層](#実効値の-3-層)
    - [GUI で変えられる項目・変えられない項目とその理由](#gui-で変えられる項目変えられない項目とその理由)
    - [yml 派と GUI 派の使い分け](#yml-派と-gui-派の使い分け)

---

## 設定の決まり方

### 実効値の 3 層

EPGStation の各設定項目の実効値は、次の 3 層を**この順に重ねて**決まる。

```
既定値 (DEFAULT_VALUE) → config.yml → 画面での変更 (DB オーバーレイ)
```

1. **既定値 (DEFAULT_VALUE)**: 何も書かなければ使われる EPGStation 組み込みの値。
2. **config.yml**: 手で編集した config.yml に値が書かれていれば、既定値より優先される。
3. **画面での変更 (DB オーバーレイ)**: サーバー設定 > 「設定ファイル」タブから変更すると、
   その差分が `app_setting` テーブルに保存され、起動時に config.yml の上に重ねて適用される。
   **config.yml 自体は書き換えない**ため、コメントや書式は失われない。

どの項目が今どの層で決まっているかは、設定画面の各項目に付くバッジ
(`既定値` / `config.yml` / `画面で変更`) で確認できる。この判定はサーバー側 (`AppSettingApiModel`)
が確定させて API 応答 (`provenance`) で返しており、画面はそれをそのまま表示するだけである。
「config.yml の値に戻す」ボタンはこの 3 層目 (画面での変更) の差分だけを消す操作であり、
config.yml 自体は変更されない。また、画面で編集した値を config.yml と同じ値に戻して保存すると、
その項目の差分は保存時に自動的に取り除かれる (触っただけで永久に「画面で変更」表示が残ることはない)。

### GUI で変えられる項目・変えられない項目とその理由

設定画面のフィールドは、サーバー側の単一スキーマ定義 (`src/model/config/ConfigSchema.ts`) から
自動的に描画されており、画面のフォームと config.yml の項目は常に一致する。

項目ごとに GUI から編集できるかどうかが決まっており、編集できない項目は画面に
「config.yml でのみ設定できる項目」として理由付きで読み取り専用表示される。この読み取り専用項目は
理由の性質によって画面上で 2 つのパネルに分かれる。

**安全上の理由で恒久的に GUI 化しない項目** (自己参照・ロックアウトの危険があるため):

| 項目                                       | 編集できない理由                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `dbtype` / `mysql` / `sqlite` / `postgres` | 画面での変更差分自体をこの DB 接続設定を使って読み出すため、誤った値を保存すると次回起動時に差分を読み出せず復旧不能になる (自己参照の詰み)。 |
| `auth`                                     | 認証設定は画面へ入るための手段そのものであり、画面から誤って変更するとロックアウトしうるため。                                                |

**単に GUI 側の実装が追いついていないだけの項目** (将来 GUI 化しうる):

`https` / `uid` / `gid` / `notifications` (config.yml 側) / `metadataChannelMappingPath` /
`metadataSharedDataUrl` / `metadataSharedDataUpdateIntervalMs` / `seriesStartup` /
`dataBroadcasting` / `metadataDefaults` / `seriesDefaults` / `importDirs` / `encodePresets` /
`urlscheme` / `kodiHosts`。このうち `metadataDefaults` / `seriesDefaults` は画面 (システム設定)
側に対応項目があり、そちらが未入力のときにのみ使われる既定値という位置づけである。

詳細な理由は設定画面の各項目に表示される。

### 秘密情報の扱い

API キー・パスワード・Webhook URL など秘密情報にあたる項目は、画面に表示する際は
`********` にマスクされる (元の値が API 応答に含まれることはない)。マスクされたまま
保存操作をしても「変更なし」として扱われ、既存の秘密情報が消えたり空文字で上書きされたり
することはない。値を変更したい場合は、マスクされた欄を新しい値で置き換えて保存する。

### yml 派と GUI 派の使い分け

- **config.yml を直接編集する**運用に向いているケース: 構成管理ツールでバージョン管理したい、
  複数台に同じ設定を配布したい、コメントを残しながら設定したい場合。
- **画面から変更する**運用に向いているケース: 一時的に値を変えて様子を見たい、
  YAML の書式を意識せず変更したい、変更履歴やロールバックを使いたい場合
  (履歴は「システム管理」内の設定変更履歴から確認・ロールバックできる)。
- 両方を併用してもよい。画面での変更は config.yml に対する差分として保存されるため、
  画面で変更していない項目は config.yml の変更がそのまま反映され続ける。

---

## 基本設定

### port

#### EPGStation が http で Web アクセスを待ち受けるポート番号

| 種類   | デフォルト値 | 必須                               |
| ------ | ------------ | ---------------------------------- |
| number | -            | no (※https の設定が無い場合は必須) |

```yaml
port: 8888
```

### socketioPort

#### EPGStation が http で Socket.IO アクセスを待ち受けるポート番号

port と同じポート番号を設定しても良い

このポートを指定した場合も、Socket.IO は port 側でも待ち受ける。
同じサーバーが LAN からの直接アクセスとリバースプロキシ経由の両方で使われることがあり、
プロキシ経由のクライアントはこの専用ポートへ到達できないため

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | port と同じ  | no   |

```yaml
socketioPort: 8889
```

### clientSocketioPort

### EPGStation の Web クライアントが接続する Socket.IO のポート番号

socketioPort を指定して Socket.IO を Web API と別のポートで待ち受けている場合に、
クライアントへ知らせるポート番号を上書きする

なお socketioPort / clientSocketioPort のいずれも指定していない場合、クライアントは
アクセスに使ったオリジン (ポート・プロトコルをそのまま) へ接続するため、
**リバースプロキシ配下でもこの設定は不要**

指定した場合も、リバースプロキシ経由でアクセスしてきたクライアントにはこのポートを知らせず、
アクセス中のオリジンへ接続させる (専用ポートは外へ公開されていないのが普通なため)

| 種類   | デフォルト値        | 必須 |
| ------ | ------------------- | ---- |
| number | socketioPort と同じ | no   |

```yaml
clientSocketioPort: 8889
```

### https

#### EPGStation が https で Web アクセスを待ち受ける設定

clientSocketioPort とは併用できないので注意

リバースプロキシを使用する場合は使用しないこと

| 子プロパティ名 | 種類   | 必須 | 説明                                     |
| -------------- | ------ | ---- | ---------------------------------------- |
| port           | number | yes  | 待ち受けポート番号                       |
| key            | string | yes  | 秘密鍵のファイルのフルパス               |
| cert           | string | yes  | 証明書のファイルのフルパス               |
| socketioPort   | number | no   | Socket.IO アクセスを待ち受けるポート番号 |

```yaml
https:
    port: 8443
    key: /hoge/huga/server.key
    cert: /hoge/huga/server.crt
    socketioPort: 8444
```

### mirakurunPath

#### 利用する Mirakurun のパスもしくは URL

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | yes  |

- unix socket、named pipe (Windows)、http、https の URL が指定可能

```yaml
mirakurunPath: 'http://localhost:40772'
```

```yaml
mirakurunPath: 'https://mirakurun.example.com'
```

### mirakurunAPIPath

#### Mirakurun の API エンドポイントのベースパス

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | /api         | no   |

```yaml
mirakurunAPIPath: '/api'
```

### tunerServerType

#### チューナーサーバーの種別

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | auto         | no   |

- `auto` / `mirakurun` / `mirakc` のいずれか
- 省略時 (`auto`) は `getServerConfig()` の成否でチューナーサーバーの種別を自動判定する。
  取得できれば Mirakurun、404 / 501 のようにエンドポイント自体が無いと判断できる応答なら mirakc と判定する。
  接続不能・タイムアウト・5xx のような一時的な失敗では判定結果をキャッシュせず、次回起動時に再判定する
- Mirakurun 互換サーバーとの接続を検証する際など、自動判定を迂回して種別を固定したい場合に指定する

```yaml
tunerServerType: 'mirakurun'
```

### dbtype

#### 使用するデータベースの種類

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | sqlite       | no   |

- 値は `mysql` `sqlite` のいずれか

```yaml
dbType: mysql
```

### mysql

#### MySQL の接続設定（MySQL 使用時は必須）

| 子プロパティ名 | 種類   | 必須 | 説明                         |
| -------------- | ------ | ---- | ---------------------------- |
| host           | string | yes  | MySQL が動作するホスト名     |
| port           | number | no   | MySQL が待ち受けるポート番号 |
| user           | string | yes  | DB 接続用のユーザー名        |
| password       | string | yes  | DB 接続用のパスワード        |
| database       | string | yes  | 使用するデータベース名       |
| charset        | string | no   | 使用する文字コード           |

```yaml
mysql:
    host: localhost
    port: 3306
    user: username
    password: password
    database: databaseName
```

### sqlite

#### SQLite3 の接続設定

| 子プロパティ名 | 種類     | 必須 | 説明                           |
| -------------- | -------- | ---- | ------------------------------ |
| extensions     | string[] | no   | 読み込む拡張機能のパス         |
| regexp         | boolean  | no   | 正規表現検索の有効化 or 無効化 |

```yaml
sqlite:
    extensions:
        - '/hoge/regexp.so'
    regexp: true
```

### ffmpeg

#### EPGStation が利用する FFmpeg のパス

| 種類   | デフォルト値          | 必須 |
| ------ | --------------------- | ---- |
| string | /usr/local/bin/ffmpeg | no   |

```yaml
ffmpeg: '/usr/bin/ffmpeg'
```

### ffprobe

#### 動画情報取得に使用する FFprobe のパス

| 種類   | デフォルト値           | 必須 |
| ------ | ---------------------- | ---- |
| string | /usr/local/bin/ffprobe | no   |

```yaml
ffprobe: '/usr/bin/ffprobe'
```

### tsreadex

#### ストリーミングの前処理に使用する tsreadex のパス

| 種類   | デフォルト値                   | 必須 |
| ------ | ------------------------------ | ---- |
| string | tsreadex (PATH 上のものを使用) | no   |

- ストリーミング設定の `cmd` 内の `%TSREADEX%` がこの値で置換される
- `cmd` に `|` を含めるとシェル経由で実行されるため、`'%TSREADEX% -x 18 -n -1 -a 13 -b 5 -c 1 -u 1 - | %FFMPEG% ...'` のような前処理パイプラインが使える

```yaml
tsreadex: '/usr/local/bin/tsreadex'
```

<a id="qsvencc"></a>

### qsvencc / nvencc / vceencc

#### rigaya 氏製ハードウェアエンコーダ (QSVEncC / NVEncC / VCEEncC) のパス

| 種類   | デフォルト値                                     | 必須 |
| ------ | ------------------------------------------------ | ---- |
| string | `QSVEncC` / `NVEncC` / `VCEEncC` (PATH 上のもの) | no   |

- [encodePresets](#encodepresets) の `hwaccel` に `qsvencc` / `nvencc` / `vceencc` を指定したときに使われる
- `config/enc.js` には環境変数 `QSVENCC` / `NVENCC` / `VCEENCC` として渡される (録画エンコード時)

```yaml
qsvencc: '/usr/local/bin/QSVEncC'
nvencc: '/usr/local/bin/NVEncC'
vceencc: '/usr/local/bin/VCEEncC'
```

---

## stuayu フォーク独自の設定

> **画面からも編集できます。** ここに挙げた項目は `config.yml` を直接書くほか、
> サーバー設定 > 「設定ファイル」タブからフォームで編集できます。
> 画面での変更は config.yml へ書き戻さず**差分として DB に保存**し、起動時に config.yml へ重ねて適用します
> (config.yml のコメントや書式は失われません)。
> ただし **DB 接続設定 (`dbtype` / `mysql` / `sqlite`) と認証設定 (`auth`) は画面から編集できません**。
> 前者は差分自体を DB から読むため誤設定で復旧できなくなるから、後者は画面へ入る手段そのものだからです。

### auth

#### Web UI / API のログイン認証

EPGStation へのアクセスにログインを必要にする。**既定で有効**。
初回アクセス時に管理ユーザーの作成画面が表示される。
リバースプロキシ側で認証している等で不要な場合は `enabled: false` を書く。

**最初にサインアップした人が自動でシステム管理者**になり、以降にサインアップした人は一般権限になる。
システム管理者は設定変更・ユーザー管理・バージョン更新ができ、他のユーザーへ随時管理者権限を付与できる。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

- 子プロパティは以下の通り

| 子プロパティ名  | 種類    | 必須 | 説明                                                               |
| --------------- | ------- | ---- | ------------------------------------------------------------------ |
| enabled         | boolean | no   | ログイン必須にするか。**省略時 true**。無効にするには false を書く |
| sessionTtlMs    | number  | no   | セッションの有効期間 (ms)。省略時 30 日                            |
| mediaTokenTtlMs | number  | no   | 外部プレイヤー用アクセストークンの有効期間 (ms)。省略時 365 日     |
| allowAnonymous  | boolean | no   | 未ログインでも一般ユーザーと同じ操作を許可するか。**省略時 true**  |
| allowSignUp     | boolean | no   | 2 人目以降のサインアップを許可するか。省略時 true                  |
| providers       | object  | no   | 外部 ID プロバイダ (SSO) の設定。`google` / `github`               |

- `providers.google` / `providers.github` の子プロパティ

| 子プロパティ名 | 種類   | 必須 | 説明                                                                                   |
| -------------- | ------ | ---- | -------------------------------------------------------------------------------------- |
| clientId       | string | yes  | OAuth クライアント ID                                                                  |
| clientSecret   | string | yes  | OAuth クライアントシークレット                                                         |
| redirectUri    | string | no   | コールバック URL。省略時は `<アクセス元 URL>/api/auth/oauth/<google\|github>/callback` |

```yaml
auth:
    # 認証そのものを止める場合のみ false を書く (既定は有効)
    # enabled: false
    sessionTtlMs: 2592000000
    allowSignUp: true
    providers:
        google:
            clientId: 'xxxxxxxx.apps.googleusercontent.com'
            clientSecret: 'xxxxxxxx'
        github:
            clientId: 'Iv1.xxxxxxxx'
            clientSecret: 'xxxxxxxx'
```

#### SSO (Google / GitHub) を使えるようにする手順

1. **プロバイダ側でアプリを登録し、コールバック URL を設定する**
    - Google: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で「OAuth クライアント ID」を作成 (種類: ウェブアプリケーション)。
      「承認済みのリダイレクト URI」に `https://<EPGStation の URL>/api/auth/oauth/google/callback` を登録する
    - GitHub: Settings > Developer settings > OAuth Apps で新規作成。
      「Authorization callback URL」に `https://<EPGStation の URL>/api/auth/oauth/github/callback` を登録する
2. **config.yml に `auth.providers` を書く** (上の例を参照)。認証自体は既定で有効なので `enabled` は不要
3. **EPGStation を再起動する** (`auth` は起動時に読まれるため)
4. Web UI を開くとログイン画面に「Google ではじめる」ボタンが出る。
   最初にサインアップした人が自動でシステム管理者になる

> `providers` を書いていない場合、ログイン画面にはユーザー名・パスワードの欄だけが出ます
> (SSO のボタンは設定済みのプロバイダの分だけ表示されます)。

#### 未ログインでの利用 (allowAnonymous)

**既定で許可**されている。**ログインしていない利用者も一般ユーザーと同じ操作**
(視聴・予約・録画の閲覧と削除など) ができる。一方で

- サーバー設定の閲覧・変更 (`/api/settings/**`)
- ログインユーザーの管理 (`/api/auth/users/**`)
- バージョン更新の実行 (`/api/update/**`)
- ログの閲覧 (`/api/logs`)

は**システム管理者としてログインしていないと行えない**ままになる。
は**システム管理者としてログインしていないと行えない**。
家庭内 LAN での利用を想定した既定値で、**認証を入れる前と同じ感覚で使えるまま、設定だけが保護される**。

```yaml
auth:
    # インターネットに公開している場合は false にする
    allowAnonymous: false
```

- 未ログインの状態でも通常画面が開き、設定画面の「ログイン」ボタンからログインできる
- 管理者向けの操作を行おうとすると自動でログイン画面へ移動する。
  ユーザーが 1 人も居なければそのまま初期セットアップ画面になり、**最初に登録した人がシステム管理者**になる
- **インターネットに公開している場合は `false` にすること。** 録画の閲覧・削除が誰でもできてしまう

---

#### 外部プレイヤー・IPTV クライアントについて

VLC / Infuse などの外部プレイヤーや IPTV クライアントは Cookie を送れないため、
動画配信 URL (`/api/videos/...`, `/api/streams/...`, `/api/iptv/...`) には
**アクセストークンをクエリで付けて認証**する。Web UI が URL を組み立てる際に自動で付与するので、
画面から「外部プレイヤーで開く」「ダウンロード」を使う分には設定は要らない。

IPTV クライアントなどに URL を手で登録する場合は、`GET /api/auth/media-token` で取得したトークンを
`?token=...` として付ける。トークンはパスワード変更・ユーザー削除で失効する。

- SSO のクライアント ID / シークレットは**ログイン前に必要**なため、DB (設定画面) ではなく config.yml に置く
- コールバック URL は `X-Forwarded-Proto` / `X-Forwarded-Host` を見てアクセス元から自動生成する。リバースプロキシ配下などで合わない場合のみ `redirectUri` を明示する
- **インターネットに公開している場合は `allowSignUp: false` を推奨**。既定のままだと Google / GitHub アカウントを持つ誰でもサインアップできてしまう (1 人目だけは常に許可される。でないと管理者を作れないため)

---

### recording

#### 録画開始のリトライ

前の番組が「放送時刻未定」(ARIB の `duration` = 0xFFFFFF) で延長していると、予約した番組の開始が遅れる。
既定の service stream では EPGStation が EIT[p/f] を読み、対象番組の境界まで同じストリームで待つ。
切り戻し用の program stream では Mirakurun が対象 event_id までデータ出力を保留する。

**「番組がまだ始まっていない」と「チューナー異常」を別枠で数える**ので、
延長待ちが異常時の再試行回数を食い潰すことはない。

`RecorderModel` は予約ごとに生成され、そのたびに設定を読むため**変更に再起動は不要**。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

- 子プロパティは以下の通り

| 子プロパティ名           | 種類    | 必須 | 説明                                                                                       |
| ------------------------ | ------- | ---- | ------------------------------------------------------------------------------------------ |
| startWaitLimitMs         | number  | no   | 番組開始を待つ上限 (ms)。省略時 3 時間。**0 で待たない**                                   |
| startWaitIntervalMs      | number  | no   | 開始待ち中の再試行間隔 (ms)。省略時 60000                                                  |
| firstDataTimeoutMs       | number  | no   | 最初の TS を待つ時間 (ms)。省略時 5000。service stream では transport 異常の判定に使い、legacy の `programStreamMode: program` では対象 event 待ちの下限として使う |
| errorFastRetryCount      | number  | no   | チューナー異常時に短い間隔で再試行する回数。省略時 3                                       |
| errorFastRetryIntervalMs | number  | no   | 同・間隔 (ms)。省略時 5000                                                                 |
| errorRetryCount          | number  | no   | その後、長い間隔で再試行する回数。省略時 27                                                |
| errorRetryIntervalMs     | number  | no   | 同・間隔 (ms)。省略時 60000                                                                |
| startGateEnabled         | boolean | no   | 予約した番組が EIT[p/f] following/present で始まるまで録画を始めない。省略時 true          |
| startGateTimeoutMs       | number  | no   | EIT[p/f] を読めないまま録画を開始するまでの時間 (ms)。省略時 60000                         |
| startGateStartMarginMs   | number  | no   | 放送中の番組の開始時刻が予約開始時刻よりこれ以上前なら前の番組とみなす (ms)。省略時 120000 |
| programStreamMode        | string  | no   | programId 予約の取得方式。`service` (既定、EPGStation が EIT 境界を管理) または `program` (切り戻し) |
| hardStartGateTimeoutMs   | number  | no   | programId 予約で別 event_id が固着した場合の開始期限 (ms)。省略時 300000                   |
| storageFallbackEnabled   | boolean | no   | 予想録画サイズに対して空きが足りない場合、`recorded` の次の保存先へ振り替える。省略時 true |
| storageFallbackMarginMB  | number  | no   | 予想録画サイズに上乗せする余裕 (MB)。省略時 3072                                           |
| storageFallbackBitrateMbps | number | no   | 予想サイズ計算に使うビットレート (Mbps)。省略時は放送種別ごとの既定値                       |
| prepRecSec               | number  | no   | 予約開始時刻の何秒前からチャンネルを開いて張り付くか。省略時 120 (EDCB に倣い 2 分前)。**マイナス不可** |
| startMarginSec           | number  | no   | 予約開始時刻の何秒前から実際に録画を開始するか。省略時 5 (EDCB の既定値)。**マイナス不可** |
| endMarginSec             | number  | no   | 予約終了時刻の何秒後まで実際に録画を続けるか。省略時 5 (EDCB の既定値)。**マイナス不可**   |

```yaml
recording:
    programStreamMode: service
    startWaitLimitMs: 10800000
    startWaitIntervalMs: 60000
    firstDataTimeoutMs: 5000
    errorFastRetryCount: 3
    errorFastRetryIntervalMs: 5000
    errorRetryCount: 27
    errorRetryIntervalMs: 60000
    startGateEnabled: true
    startGateTimeoutMs: 60000
    startGateStartMarginMs: 120000
    hardStartGateTimeoutMs: 300000
    storageFallbackEnabled: true
    storageFallbackMarginMB: 3072
    storageFallbackBitrateMbps: 19
    prepRecSec: 120
    startMarginSec: 5
    endMarginSec: 5
```

- 値が範囲外・不正な場合は既定値へ丸めるため、設定ミスで録画が動かなくなることはない
- 野球中継などの長い延長に備える場合は `startWaitLimitMs` を延ばす
- `programStreamMode: service` (既定) では programId 予約もサービスストリームを使い、TS 到着 (transport) と EIT[p/f] 境界待ちを分離する。target present の event_id 一致、target following の start_time 到達を通常開始条件とし、EIT が無い場合は soft timeout (既定 60 秒)、別 event_id 固着は hard timeout (既定 5 分) で安全側に開始する。待機中の TS は最大 8 MiB のリングバッファへ保持する
- soft/hard timeout で fallback 開始した場合は、全損を避ける代わりにリングバッファ内の前番組が最大 8 MiB 混ざり得る。開始理由は Operator の info ログで `eitSoftTimeout` / `eitHardTimeout` として区別できる
- `startGateEnabled` は EIT[p/f] 境界待ちを有効にする (時刻指定予約・programId 予約の両方)。時刻指定予約では following の `start_time` を優先し、present 更新前でも目的番組の開始を判断する。programId 予約では対象 present の event_id 一致を優先し、EIT 無しの soft timeout と別 event_id 固着の hard timeout を安全弁として使う。待機中の TS は最大 8 MiB を保持して開始時に書き出す
- service stream は予約終了時刻 + margin のハードタイマーで終了し、対象 present が別 event_id に変化してもデバウンス後に終了する。EPG 追従の endAt 更新は programId 予約にも反映する (録画準備中の変更は録画開始を待ってから反映する)。`programStreamMode: program` は切り戻し用である

##### 空き容量による録画先の自動振り替え

録画を始めてから保存先が満杯 (`ENOSPC`) になると、0 バイトのファイルと失敗した録画情報だけが残る。
リトライしても同じディレクトリへ書きに行くため復旧しない。そこで**録画開始前に予想サイズを計算し、
空きが足りなければ `recorded` の次の保存先へ振り替える**。

- 予想サイズ = 番組長 × 放送種別ごとの想定ビットレート ÷ 8 + `storageFallbackMarginMB`
- 既定ビットレート (Mbps): GR 19 / BS 26 / CS・SKY 20 / BS4K・CS4K 40。**表に無い放送種別 (県外地上波 NW1〜NW40 など) は 19**
- 余裕 (既定 3072MB) は、同時に走る他の録画・エンコードの書き込み分を見込んだもの
- 候補は「本来の保存先 → `recorded` の定義順」。**満杯になり次第、順次さらに次の候補へ送る**
- どの保存先も足りない場合は、少しでも長く録れるよう**最も空きが大きい保存先**を使い error ログを出す
- 空き容量を取得できない保存先 (未マウント等) は候補から外す。1 つも取得できない場合は本来の保存先のまま進める
- 振り替えが起きると Operator のログに warn で出る

```
recording dir fallback: reserveId: 12, TS -> TS2, required: 5350MB, free: 61MB
recording dir has no room: reserveId: 13, using TS2, required: 5350MB, free: 900MB
```

`storageFallbackEnabled: false` で無効にできる。`recorded` が 1 つしかない場合は何もしない。

##### 録画のタイミング (張り付き・開始マージン・終了マージン)

紛らわしいので用語を分けてある。**3 つとも負値は受け付けず、0 未満は 0 に丸める**。

| 用語 | 設定 | 意味 |
| --- | --- | --- |
| 張り付き | `prepRecSec` | 予約開始時刻の N 秒前にチューナーを確保してストリームを開き、EIT[p/f] の監視を始める。**まだ録画ファイルへは書かない**。既定 120 秒 |
| 開始マージン | `startMarginSec` | 予約開始時刻の N 秒前から実際の録画開始を許可する。既定 5 秒 |
| 終了マージン | `endMarginSec` | 予約終了時刻の N 秒後まで録画を続ける。既定 5 秒 |

- **張り付きは必ず開始マージンより前になる**。`prepRecSec` が `startMarginSec` 以下だと、ストリームを開いた瞬間に開始判定が走り EIT を 1 度も読めないまま録画が始まってしまうため、`startMarginSec + 5 秒` まで自動で押し上げる
- **既定値は EDCB に合わせてある** (張り付き 2 分前 / 開始マージン 5 秒 / 終了マージン 5 秒)。マージンを付けたくない場合は `startMarginSec: 0` / `endMarginSec: 0` を明示する
- **開始ゲートの上限 (`startGateTimeoutMs` / `hardStartGateTimeoutMs`) は「予約開始時刻 (開始マージン込み)」から数える**。張り付きを延ばしても soft / hard timeout が予定開始より前に発火して前番組を録り始めることはない
- 既存の `timeSpecifiedStartMargin` / `timeSpecifiedEndMargin` (時刻指定予約用) はそのまま残り、**大きい方**が採用される。片方だけ大きくしたい場合に使える
- **programId 予約でも効く**。対象 following の開始時刻に `startMarginSec` だけ前倒しで到達判定する。ただし放送が予定より早く始まって EIT[p/f] present が対象 event_id になった場合は、マージンを待たずその時点から録る
- 張り付きを延ばすとチューナーをその分長く占有する。同時録画数に余裕がない環境では詰まる可能性がある
- **チューナー再利用時に許容する末尾欠けは `prepRecSec` とは連動しない** (固定 15 秒)。連動させると張り付きを延ばした分だけ、実行中の `allowEndLack` 録画の末尾を切り落としてしまう
- **録画準備中に EPG 追従で終了時刻が動いた場合 (延長) も取りこぼさない**。`RecordingStreamCreator` が新しい `endAt` を覚えておき、ストリーム取得時にハードタイマーへ反映する。予約更新側は待たされない

---

### featureFlags

#### 機能フラグ

機能ごとの有効・無効を切り替える。**未指定の項目は有効**として扱うため、
止めたい機能だけ `false` を書く (`featureFlags` 自体を省略すると全機能が有効)。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

| 子プロパティ名       | 説明                                                    |
| -------------------- | ------------------------------------------------------- |
| watchHistory         | 視聴履歴                                                |
| notifications        | 通知 (Webhook / Discord)                                |
| dashboard            | ダッシュボード                                          |
| systemSettings       | サーバー設定画面                                        |
| seriesLibrary        | シリーズライブラリ                                      |
| metadataProviders    | メタデータ連携 (しょぼいカレンダー / Annict / Wikidata) |
| programSeriesMapping | 番組⇄シリーズの事前マッピング                           |
| annictSync           | Annict 視聴記録の同期                                   |
| nextUpPanel          | 「次に見る」パネル                                      |
| externalFileImport   | 外部録画ファイルの取り込み                              |
| advancedSearch       | 保存検索                                                |
| updateNotification   | 更新通知・ワンクリック更新                              |

```yaml
featureFlags:
    annictSync: false
```

---

### seriesLlm

#### シリーズ名の LLM 抽出

作品辞書で確定できなかった録画タイトルから、LLM に番組名を抽出させる。
抽出結果はそのまま信用せず必ず作品辞書で引き直して検証する。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

| 子プロパティ名 | 種類   | 必須 | 説明                                                                                |
| -------------- | ------ | ---- | ----------------------------------------------------------------------------------- |
| url            | string | yes  | OpenAI 互換 Chat Completions API のベース URL (Ollama: `http://localhost:11434/v1`) |
| model          | string | yes  | モデル名                                                                            |
| apiKey         | string | no   | API キー (ローカル LLM では通常不要)                                                |
| timeoutMs      | number | no   | タイムアウト (ms)。省略時 30000                                                     |
| minIntervalMs  | number | no   | リクエスト間隔の下限 (ms)。省略時 0                                                 |
| maxTokens      | number | no   | 応答の上限トークン数。省略時 2000                                                   |
| maxTokensLimit | number | no   | 上限が足りず本文が空で切れた場合の自動引き上げの天井。省略時 16000                  |

```yaml
seriesLlm:
    url: 'http://localhost:11434/v1'
    model: 'qwen2.5:7b-instruct'
```

- reasoning 系モデルは思考にトークンを使うため、`maxTokens` が小さいと本文が空のまま切れる。その場合は**自動で 4 倍ずつ引き上げて再試行**し、成功した値を以後の既定として使うため通常は指定不要

---

### updateChecker

#### 新しいバージョンの公開チェック

GitHub Releases を定期的に確認し、新しいバージョンが公開されていれば Web UI で知らせる。
`featureFlags.updateNotification` が有効な場合のみ動作する (既定は有効)。
git clone した環境では、サーバー設定画面の「更新」タブから**リリース版**または**追従ブランチ (既定 main) の最新コミット**へワンクリックで更新できる (git checkout → 依存インストール → ビルド → 再起動)。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

- 子プロパティは以下の通り

| 子プロパティ名    | 種類    | 必須 | 説明                                                                                   |
| ----------------- | ------- | ---- | -------------------------------------------------------------------------------------- |
| repository        | string  | no   | 監視するリポジトリ (`owner/repo` 形式)。省略時 `stuayu/EPGStation`                     |
| branch            | string  | no   | 「最新の開発版へ更新」で追従するブランチ。省略時 `main`                                |
| checkIntervalMs   | number  | no   | チェック間隔 (ms)。省略時 6 時間。0 以下でチェックを停止する                           |
| includePrerelease | boolean | no   | プレリリース (rc / beta / alpha) も通知するか。省略時 true (UI では色を変えて区別する) |

```yaml
updateChecker:
    repository: 'stuayu/EPGStation'
    branch: 'main'
    checkIntervalMs: 21600000
    includePrerelease: true
```

---

### dataBroadcasting

#### データ放送 (BML) 配信

`featureFlags.dataBroadcasting` が有効な場合のみ動作する (既定は有効)。
ライブ・録画再生画面でデータ放送を有効にすると、クライアントは WebSocket (`/api/dataBroadcasting/ws`) 経由でカルーセルのモジュール等を受け取る。
BML の描画は npm 依存の `web-bml` (tsukumijima/web-bml) が担い、映像は引き続き EPGStation 側のプレイヤーが再生する。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

- 子プロパティは以下の通り

| 子プロパティ名 | 種類   | 必須 | 説明                                                                                       |
| -------------- | ------ | ---- | ------------------------------------------------------------------------------------------ |
| maxStreams     | number | no   | WebSocket 経由のデータ放送ストリームの同時本数上限。省略時 4。超えると最も古い接続を閉じる |

```yaml
dataBroadcasting:
    maxStreams: 4
```

---

### amatsukaze

#### CM カット・ロゴ消しを Amatsukaze に任せる

エンコードプリセット (`encode`) の `cmd` に `dist/AmatsukazeEncodeTool.js` を指定すると、録画後のエンコードを
[Amatsukaze](https://github.com/nekopanda/Amatsukaze) に投げられる。`AmatsukazeAddTask` でキューに投入したあと
`AmatsukazeServer` へ TCP 接続して自分のタスクだけを追跡し、進捗・処理状況 (キュー待ち・エンコード中など) を
EPGStation のエンコード画面へリアルタイムに表示する。失敗した場合は Amatsukaze 側の失敗理由がそのまま表示される。

`encode` の書式例:

```yaml
encode:
    - id: amatsukaze
      name: Amatsukaze
      cmd: '%NODE% %ROOT%/dist/AmatsukazeEncodeTool.js プロファイル名'
      suffix: .mp4
      # キュー待ちの時間も含むためタイムアウト倍率は長めにする
      rate: 12.0
```

このセクション自体は上記の `amatsukaze` オブジェクトで、接続先・投入方法・パス変換をまとめて設定する。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| object | -            | no   |

- 子プロパティは以下の通り

| 子プロパティ名   | 種類               | 必須 | 説明                                                                                    |
| ---------------- | ------------------- | ---- | ---------------------------------------------------------------------------------------- |
| host             | string              | no   | AmatsukazeServer のアドレス。省略時 `localhost`                                          |
| port             | number              | no   | AmatsukazeServer のポート。省略時 32768                                                  |
| addTaskPath      | string              | no   | `AmatsukazeAddTask` (.exe) のパス                                                        |
| amatsukazeRoot   | string              | no   | Amatsukaze のルートディレクトリ (`AmatsukazeAddTask` の `-r`。未起動時の自動起動に使う)  |
| monoPath         | string              | no   | Windows 以外で `AmatsukazeAddTask.exe` を mono 経由で起動する場合の mono のパス          |
| profile          | string              | no   | 既定のプロファイル名。エンコードコマンドの第 1 引数で上書きできる                        |
| priority         | number              | no   | キューの優先度 (1〜5)。省略時 3                                                          |
| noMove           | boolean             | no   | TS ファイルを「転送済み」フォルダへ移動しない (`--no-move`)。省略時 true                 |
| connectTimeoutMs | number              | no   | AmatsukazeServer への接続を諦めるまでの時間 (ms)。省略時 60000                           |
| taskTimeoutMs    | number              | no   | タスクの状態が変化しないまま経過したら諦める時間 (ms)。省略時 0 (打ち切らない)           |
| pathMappings     | 子プロパティの配列  | no   | EPGStation と Amatsukaze が別マシンにある場合の入出力パス変換 (下記参照)                 |

- `pathMappings` の子プロパティは以下の通り

| 子プロパティ名 | 種類   | 必須 | 説明                                  |
| -------------- | ------ | ---- | ------------------------------------- |
| local          | string | yes  | EPGStation 側から見たパスの先頭部分   |
| remote         | string | yes  | Amatsukaze 側から見た対応するパスの先頭部分 |

`local` から始まるパスを `remote` に置き換えて `AmatsukazeServer` へ渡し、`AmatsukazeServer` が返したパスは
`remote` → `local` に戻して EPGStation 側で扱う。

```yaml
amatsukaze:
    host: localhost
    port: 32768
    addTaskPath: /home/user/Amatsukaze/exe_files/AmatsukazeAddTask.exe
    amatsukazeRoot: /home/user/Amatsukaze
    monoPath: /usr/bin/mono
    profile: デフォルト
    priority: 3
    noMove: true
    connectTimeoutMs: 60000
    taskTimeoutMs: 0
    pathMappings:
        - local: /mnt/recorded
          remote: \\nas\recorded
```

- **この項目は GUI から編集できない (`editable: 'ymlOnly'`、理由: `notYetWired`)**。
  エンコードコマンド (`dist/AmatsukazeEncodeTool.js`) は録画エンコードとは独立したプロセスとして起動され、
  画面で変更した設定 (DB オーバーレイ) を読まずに config.yml だけを読む。そのため GUI 編集を許すと
  「画面では変わっているのに実際のエンコードには反映されない」状態になってしまうため、当面は
  config.yml の直接編集のみに限定している
- 従来の `config/amatsukaze_addtask.bat.template` (出力ファイルの存在を一定間隔で見に行くだけの方式) は
  進捗も失敗理由も分からないため同梱をやめた。使っていた場合は encode プリセットの cmd を
  `dist/AmatsukazeEncodeTool.js` に差し替える

---

## 詳細設定

### needToReplaceEnclosingCharacters

#### 番組情報の囲み文字を [] で括った文字に置換するか

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | true         | no   |

```yaml
needToReplaceEnclosingCharacters: true
```

### isHideDuplicateSubChannel

#### 内容が親チャンネルと同じサブチャンネルを番組表・放映中に表示しないか

同一 networkId 内で serviceId が最小のチャンネルを親とし、自身の番組がすべて親の同時刻・同名の番組と一致するサブチャンネル (○○２ / ○○３ など) を番組表・放映中の一覧から除外する。

未運用のサブチャンネルまで全サービスを返すチューナーサーバ (recisdb-proxy など) では、親と同じ EIT がサブサービスにも載るため同じ番組の列が並んでしまう。この設定はその重複を隠すためのもの。サブチャンネルが親と異なる番組を放送している間は除外されない。

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | true         | no   |

```yaml
isHideDuplicateSubChannel: true
```

### recPriority

#### 録画時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 2            | no   |

```yaml
recPriority: 20
```

### conflictPriority

#### 競合録画時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

- 予約が競合する番組に適用される

```yaml
conflictPriority: 10
```

### timeSpecifiedStartMargin

#### 手動予約時の開始マージン(秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

```yaml
timeSpecifiedStartMargin: 2
```

### timeSpecifiedEndMargin

#### 手動予約時の終了マージン(秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

```yaml
timeSpecifiedEndMargin: 2
```

### recordedHistoryRetentionPeriodDays

#### 重複確認用に使用する番組名を保管する期間

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 90           | no   |

```yaml
recordedHistoryRetentionPeriodDays: 180
```

### epgUpdateIntervalTime

#### 番組情報を更新する時間の間隔 (分)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 10           | no   |

```yaml
epgUpdateIntervalTime: 15
```

### epgFullRefreshIntervalTime

#### event stream が動いていても番組表を全件取り直す間隔 (分)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 360          | no   |

```yaml
epgFullRefreshIntervalTime: 360
```

Mirakurun の event stream は**差分しか運ばない**。既存番組の `update` は届き続けるのに
新しく増えた番組の `create` が届かない状態になると、EPGStation の DB は古いまま残り、
**再起動して全件取得が走るまで番組表が増えない**。

これを検知するための既存のウォッチドッグは「イベントが一定時間来ないこと」しか見ていないため、
イベントが届き続けているこのケースでは発火しない。そこで event stream の状態に関わらず、
この間隔ごとに `getPrograms()` で全件取り直して DB を突き合わせる。

`0` で無効。全件取得は番組数に比例して重いので、短くしすぎない (既定 6 時間)。
実行時は Operator のログに `periodic full refresh` が出る。

### epgRetentionTime

#### 過去の番組表データを残す時間 (時間)

終了した番組の情報をどれだけ残すかを指定する。`0` なら終了した番組を順次削除する (従来の動作)。
`-1` を指定すると削除せず**無期限に保存**する (過去の番組表を遡って見られるが DB は増え続ける)。

保存期間内の番組は EPG の全件更新時にも削除されない。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
# 過去 30 日分を残す
epgRetentionTime: 720
```

```yaml
# 無期限に残す
epgRetentionTime: -1
```

### epgDeleteIntervalTime

#### 過去の番組表データを削除する間隔 (分)

省略時は `epgUpdateIntervalTime` と同じ間隔で削除する。`epgRetentionTime` が `-1` (無期限) の場合は削除自体が行われない。

| 種類   | デフォルト値                 | 必須 |
| ------ | ---------------------------- | ---- |
| number | epgUpdateIntervalTime と同じ | no   |

```yaml
epgDeleteIntervalTime: 60
```

### epgRealtime

#### EPG のリアルタイム同期

災害発生時の特別番組への差し替えや前番組の延長による番組情報の変更を、`epgUpdateIntervalTime` の周期を待たずに DB へ反映する。

Mirakurun / recisdb-proxy の event stream から受け取った更新イベントのうち、次のいずれかに該当するものだけを先行して反映する (それ以外は従来どおり周期反映のままなので DB の負荷は増えない)。

- 番組の消滅・付け替え (`remove` / `redefine`)
- 放送時間未定 (ARIB の `duration = 0xFFFFFF`) への変更 — 放送時刻に関わらず対象
- `urgentWindowMinutes` 以内に始まる、または放送中の番組の更新

機能の有効・無効は機能フラグ `featureFlags.epgRealtimeSync` で切り替える (未指定なら有効)。この項目は反映の細かい挙動を調整するためのもので、すべて省略できる。

| 子項目              | 種類   | デフォルト値 | 必須 | 説明                                                             |
| ------------------- | ------ | ------------ | ---- | ---------------------------------------------------------------- |
| debounceMs          | number | 500          | no   | 連続して届く更新を 1 回の DB 更新にまとめるための待ち時間 (ミリ秒) |
| minIntervalMs       | number | 500          | no   | 先行反映同士の最小間隔 (ミリ秒)                                  |
| urgentWindowMinutes | number | 180          | no   | これ以内に始まる番組の変更を即時反映の対象とする (分)            |

```yaml
epgRealtime:
    debounceMs: 500
    minIntervalMs: 500
    urgentWindowMinutes: 180
```

mirakc を使っている場合、番組情報の更新は元々 serviceId 単位で 10 秒ごとに反映されるため、この設定は影響しない。

recisdb-proxy のような Mirakurun 互換実装を使う場合は、`tunerServerType: mirakurun` を明示して自動判定を無効にすること (`/api/config/server` を返さない実装は mirakc と誤判定される)。

### isSuppressReservesUpdateAllLog

#### 予約定期更新時のログ出力を抑えるか

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

```yaml
isSuppressReservesUpdateAllLog: true
```

### channelOrder

#### チャンネルの並び順を指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
  id を入力

```yaml
channelOrder:
    - 3273601024
    - 3273701032
    - 3273801040
    - 3274101064
    - 3273901048
    - 3274201072
    - 3274001056
```

### sidOrder

#### sid でチャンネルの並び順を指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
  serviceId を入力

**channelOrder が存在する場合はそちらが優先されるため注意**

```yaml
sidOrder:
    - 1024
    - 1032
    - 1040
    - 1064
    - 1048
    - 1072
    - 1056
```

### excludeChannels

#### 除外するチャンネルを指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
  id を入力

```yaml
excludeChannels:
    - 3239123608
    - 400231
```

### excludeSids

#### sid で除外するチャンネルを指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
  serviceId を入力

```yaml
excludeSids:
    - 23608
    - 231
```

### gid

#### EPGStation が利用するグループ ID or グループ名

| 種類             | デフォルト値 | 必須 |
| ---------------- | ------------ | ---- |
| string \| number | -            | no   |

```yaml
gid: hoge
```

### uid

#### EPGStation が利用するユーザー ID or ユーザー名

| 種類             | デフォルト値 | 必須 |
| ---------------- | ------------ | ---- |
| string \| number | -            | no   |

```yaml
uid: fuga
```

### isEnabledDropCheck

#### 録画時のドロップチェックを有効化する

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

```yaml
isEnabledDropCheck: true
```

### dropLog

#### ドロップチェック時に生成される .log ファイルの保存先

| 種類   | デフォルト値                                                          | 必須 |
| ------ | --------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/drop (EPGStation 直下の drop ディレクトリのフルパス) | no   |

- フルパスで指定する

```yaml
dropLog: '/hoge/fuga',
```

### subDirectory

#### サブディレクトリとして動作させる (リバースプロキシ利用時を想定)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

- `http://<IPaddress>:<Port>/<subDirectory>`として動作する

```yaml
subDirectory: subdir
```

### apiServers

#### Suagger UI で使用するサーバリスト

| 種類     | デフォルト値                | 必須 |
| -------- | --------------------------- | ---- |
| string[] | [ 'http://localhost:8888' ] | no   |

```yaml
apiServers:
    - http://localhost:8888
    - http://xxx.xxx.xxx.xxx:8888
```

[WebAPI Document](./webapi.md)

### isAllowAllCORS

#### CORS ヘッダーをすべて許可する (いずれ真面目に実装した際に削除する予定)

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

---

## ファイル保存先

### recorded

#### 録画ファイルの保存先

| 種類               | デフォルト値           | 必須 |
| ------------------ | ---------------------- | ---- |
| 子プロパティの配列 | 下記デフォルト値を参照 | no   |

- デフォルト値

```yaml
recorded:
    - name: recorded
      path: /hoge/huge/EPGStation/recorded # EPGStation 直下にある recorded のフルパス
```

- 子プロパティは以下の通り

| 子プロパティ名 | 種類               | 必須 | 説明                                                                          |
| -------------- | ------------------ | ---- | ----------------------------------------------------------------------------- |
| name           | string             | yes  | Web インターフェイス上で表示される名前                                        |
| path           | string             | yes  | 保存先ディレクトリパス (フルパスで指定すること)                               |
| limitThreshold | number             | no   | 空き容量限界閾値 (単位 MB)。これを超えると action, limit で指定した動作を行う |
| action         | 'remove' \| 'none' | no   | 下記の limitThreshold 説明を参照                                              |
| limitCmd       | string             | no   | limitThreshold を超えた時に実行するコマンド                                   |

- フルパスで指定する

##### limitThreshold 説明

- remove
    - limitThreshold 内に空き容量が収まるまで古い順に録画番組を自動削除する
- none
    - 何もしない

```yaml
recorded:
    - name: hoge-name
      path: 'HOGE-HUGA'
```

### recordedTmp

#### 録画ファイルの一時保存先

録画が完了したら recorded で指定したディレクトリへ移動する

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

- フルパスで指定する

```yaml
recordedTmp: '/hoge/fuga'
```

### recordedFormat

#### 録画ファイルのファイル名テンプレート

| 種類   | デフォルト値                                           | 必須 |
| ------ | ------------------------------------------------------ | ---- |
| string | %YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE% | no   |

- 使用可能な変数は以下の通り

| 変数名              | 説明                          |
| ------------------- | ----------------------------- |
| %YEAR%              | 年                            |
| %SHORTYEAR%         | 年 (下２桁)                   |
| %MONTH%             | 月                            |
| %DAY%               | 日付                          |
| %HOUR%              | 時                            |
| %MIN%               | 分                            |
| %SEC%               | 秒                            |
| %DOW%               | 曜日                          |
| %TYPE%              | "GR" \| "BS" \| "CS" \| "SKY" |
| %CHID%              | Channel ID                    |
| %CHNAME%            | チャンネル名                  |
| %HALF_WIDTH_CHNAME% | チャンネル名 (半角)           |
| %CH%                | チャンネル番号                |
| %SID%               | サービス ID                   |
| %ID%                | Program ID                    |
| %TITLE%             | 番組タイトル                  |
| %HALF_WIDTH_TITLE%  | 番組タイトル (半角)           |

```yaml
recordedFormat: '%TITLE% [%CHNAME%] %YEAR%年%MONTH%月%DAY%日(%DOW%曜日)'
```

### recordedFileExtension

#### 録画ファイルの拡張子

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | .ts          | no   |

- MPEG2-TS の拡張子は`.ts` `.mts` `.m2t` `.m2ts`のいずれかが望ましい
- ピリオド`.`を付け忘れないように

```yaml
recordedFileExtension: .m2ts
```

### storageLimitCheckIntervalTime

#### ストレージの空き容量をチェックする間隔 (秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 60           | no   |

```yaml
storageLimitCheckIntervalTime: 120
```

### thumbnail

#### サムネイル画像ファイルの保存先

| 種類   | デフォルト値                                                                    | 必須 |
| ------ | ------------------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/thumbnail (EPGStation 直下の thumbnail ディレクトリのフルパス) | no   |

```yaml
thumbnail: '/hoge/thumbs'
```

### thumbnailCmd

#### サムネイル生成時のコマンド

| 種類   | デフォルト値                                                                                        | 必須 |
| ------ | --------------------------------------------------------------------------------------------------- | ---- |
| string | '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%' | no   |

- 置換される変数は以下の通り

| 変数名               | 説明                                    |
| -------------------- | --------------------------------------- |
| %FFMPEG%             | EPGStation が利用している ffmpeg のパス |
| %INPUT%              | 入力ファイルパス                        |
| %OUTPUT%             | 出力ファイルパス                        |
| %THUMBNAIL_POSITION% | サムネイル再生位置 (秒)                 |
| %THUMBNAIL_SIZE%     | サムネイルの画像のサイズ                |

```yaml
thumbnailCmd: '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%'
```

### thumbnailSize

#### サムネイル画像の解像度

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | 480x270      | no   |

- 横解像度 x 縦解像度で記載する（x は小文字のエックス）

```yaml
thumbnailSize: '320x180'
```

### thumbnailPosition

#### サムネイル画像を生成する再生位置（秒）

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 5            | no   |

```yaml
thumbnailPosition: 30
```

### uploadTempDir

#### ファイルアップロード時の利用する一時領域

| 種類   | デフォルト値                                                                        | 必須 |
| ------ | ----------------------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/data/upload (EPGStation 直下の data/upload ディレクトリのフルパス) | no   |

```yaml
uploadTempDir: '/hoge/tmp/upload'
```

---

## 外部コマンド実行

### reserveNewAddtionCommand

- 録画予約の新規追加時に実行されるコマンド

### reserveUpdateCommand

- 録画情報の更新時に実行されるコマンド

### reservedeletedCommand

- 録画予約の削除時に実行されるコマンド

### recordingPreStartCommand

- 録画準備の開始時に実行されるコマンド

### recordingPrepRecFailedCommand

- 録画準備の失敗時に実行されるコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

- 実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                          |
| ---------------------- | -------------- | ----------------------------- |
| PROGRAMID              | number         | Program ID                    |
| CHANNELTYPE            | string         | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID              | number         | Channel ID                    |
| CHANNELNAME            | string \| null | 放送局名                      |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                |
| STARTAT                | number         | 開始時刻 (UNIX time)          |
| ENDAT                  | number         | 終了時刻 (UNIX time)          |
| DURATION               | number         | 長さ (ms)                     |
| NAME                   | string         | 番組名                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                  |
| DESCRIPTION            | string \| null | 番組概要                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                |
| EXTENDED               | string \| null | 番組詳細                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                |

```yaml
reserveNewAddtionCommand: '/bin/node /home/hoge/fuga.js reserve'
reserveUpdateCommand: '/bin/node /home/hoge/piyo.js update'
reservedeletedCommand: '/bin/bash /home/hoge/bar.sh deleted'
recordingPreStartCommand: '/bin/bash /home/hoge/foo.sh prestart'
recordingPrepRecFailedCommand: '/usr/bin/logger prepfailed'
```

### recordingStartCommand

- 録画開始時に実行するコマンド

### recordingFinishCommand

- 録画終了時に実行するコマンド

### recordingFailedCommand

- 録画中のエラー発生時に実行するコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

- 実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                          |
| ---------------------- | -------------- | ----------------------------- |
| RECORDEDID             | number         | recorded id                   |
| PROGRAMID              | number         | program id                    |
| CHANNELTYPE            | string         | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID              | number         | channel id                    |
| CHANNELNAME            | string \| null | 放送局名                      |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                |
| STARTAT                | number         | 開始時刻 (UNIX time)          |
| ENDAT                  | number         | 終了時刻 (UNIX time)          |
| DURATION               | number         | 長さ (ms)                     |
| NAME                   | string         | 番組名                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                  |
| DESCRIPTION            | string \| null | 番組概要                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                |
| EXTENDED               | string \| null | 番組詳細                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                |
| RECPATH                | string         | 録画ファイルのフルパス        |
| LOGPATH                | string\| null  | ログファイルのフルパス        |
| ERROR_CNT              | number \| null | エラーカウント                |
| DROP_CNT               | number \| null | ドロップカウント              |
| SCRAMBLING_CNT         | number \| null | スクランブルカウント          |

```yaml
recordingStartCommand: '/bin/node /home/hoge/fuga.js start'
recordingFinishCommand: '/bin/bash /home/hoge/foo.sh end'
recordingFailedCommand: '/usr/bin/logger recfailed'
```

### encodingFinishCommand

エンコード完了時のサムネイル生成はEPGStationが自動で実行する。サムネイル更新専用スクリプトをこの設定へ登録する必要はない。

- エンコード終了時に実行するコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

- 実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                                   |
| ---------------------- | -------------- | -------------------------------------- |
| RECORDEDID             | number         | recorded id                            |
| VIDEOFILEID            | number \| null | video file id                          |
| OUTPUTPATH             | string \| null | エンコードしたビデオファイルのフルパス |
| MODE                   | string         | エンコードモード名                     |
| CHANNELID              | number         | channel id                             |
| CHANNELNAME            | string \| null | 放送局名                               |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                         |
| NAME                   | string         | 番組名                                 |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                           |
| DESCRIPTION            | string \| null | 番組概要                               |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                         |
| EXTENDED               | string \| null | 番組詳細                               |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                         |

```yaml
encodingFinishCommand: '/bin/node /home/hoge/fuga.js finish'
```

### encodeProcessNum

#### 録画ファイルのバックグラウンドエンコードで使用されるプロセスの上限数

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

```yaml
encodeProcessNum: 3
```

### streamProcessNum

#### ライブ視聴・録画再生ストリーミングで使用されるプロセスの上限数

`encodeProcessNum` とは独立した上限です。ライブ視聴および録画再生（HLS・通常ストリーミング）の
プロセス数を合計して制限します。録画ファイルのバックグラウンドエンコードが上限まで実行中でも、
この値に空きがあれば視聴を開始できます。

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 4            | no   |

```yaml
streamProcessNum: 4
```

### concurrentEncodeNum

#### 同時エンコード数

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
concurrentEncodeNum: 1
```

### encodePresets

#### エンコードプリセット表の一括有効化フラグ

「ハードウェア × コーデック × 画質 × 用途」の組み合わせから、録画エンコード (`encode`) と
配信プリセット (`stream.profiles.live` / `stream.profiles.recorded.ts` / `stream.profiles.recorded.encoded`)
を自動生成する。1 つずつ手書きしてコメントアウトで管理する代わりに、使いたい軸をフラグで
指定するだけで該当する組み合わせがまとめて有効になる。

> 注意: `GET /api/config` のレスポンスにも `encodePresets` というフィールドがあるが、
> これは `encode` から作られるクライアント表示用の解決済み一覧 (配列) であり、
> ここで説明する config.yml の一括有効化フラグ (オブジェクト) とは別物である。

| 子プロパティ名 | 種類     | デフォルト値                             | 必須 | 説明                                                                            |
| -------------- | -------- | ---------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| hwaccel        | string   | `software`                               | no   | `software` \| `qsv` \| `vaapi` \| `nvenc` \| `qsvencc` \| `nvencc` \| `vceencc` |
| codecs         | string[] | `[h264]`                                 | no   | `h264` \| `hevc` の配列                                                         |
| qualities      | string[] | `[1080p, 720p, 480p]`                    | no   | `2160p` \| `1080p` \| `720p` \| `480p` \| `240p` の配列                         |
| targets        | string[] | `[recorded, liveHLS, recordedStreaming]` | no   | 生成対象の配列 (下記参照)                                                       |

- `hwaccel`
    - `software`: libx264 / libx265 (CPU エンコード)
    - `qsv`: Intel Quick Sync Video (`h264_qsv` / `hevc_qsv`)
    - `vaapi`: AMD/Intel VAAPI (`h264_vaapi` / `hevc_vaapi`)。**Linux 専用**、`/dev/dri/renderD128` への
      アクセス権限が必要 (Docker では `--device /dev/dri` を渡す)。ffmpeg が対応エンコーダ付きで
      ビルドされている必要がある
    - `nvenc`: NVIDIA NVENC (`h264_nvenc` / `hevc_nvenc`)
    - `qsvencc` / `nvencc` / `vceencc`: rigaya 氏製の QSVEncC / NVEncC / VCEEncC を使う。
      実行ファイルパスは [qsvencc / nvencc / vceencc](#qsvencc) で指定する (省略時は PATH 上のコマンド名)。
      録画エンコードは `config/enc.js` が直接呼び出し、配信は「rigaya 系エンコーダ →
      パイプ → ffmpeg で remux」の 2 段構成になる (デコード・デインタレース・リサイズ・
      エンコードは rigaya 側、fMP4 / HLS のコンテナ処理は ffmpeg 側)
    - 未対応の値を書いた場合は `software` として扱われる (`codecs` / `qualities` / `targets` の
      未対応要素も同様に無視され、すべて無効なときは既定値が使われる)
- `qualities`
    - `2160p` は新4K8K衛星放送 (`BS4K` / `CS4K`) 向け。映像 15000kbps / 音声 256kbps の
      **HEVC 前提のビットレート**なので `codecs: [hevc]` と組み合わせて使う
      (H.264 で 4K を出す場合は Level 5.2 が指定されるが、同じビットレートでは画質が落ちる)
- `targets`
    - `recorded`: 録画ファイルのバックグラウンドエンコード (`config/enc.js` 経由、`encode` 相当)
    - `liveHLS`: ライブ視聴の HLS 配信 (in-memory LL-HLS、`stream.profiles.live` の container: hls 相当)
    - `recordedStreaming`: 録画再生の mp4 / HLS 配信 (`stream.profiles.recorded.{ts,encoded}` 相当)。
      HLS も in-memory LL-HLS で配信する
    - webm (vp9) はこのプリセット表の対象外。従来通り `stream.profiles` に手書きする

#### 生成されるコマンドの iOS / Safari 互換

`encodePresets` が生成するコマンドは、iPhone / iPad / Safari でそのまま再生できる形に揃えてある。

- **HLS はライブ・録画済みとも fMP4 セグメントの LL-HLS (`#EXT-X-PART`) で配信する** (メモリ上で
  セグメント化するのでディスクへは書き出さない)。Apple の HLS は **HEVC を fMP4 でしかサポートしない**ため、
  MPEG-TS セグメントでは HEVC を再生できない
- **HEVC には `hvc1` タグを付ける**。ffmpeg の既定は `hev1` で、そのままでは iOS / Safari で映像が出ない。
  rigaya 系 (QSVEncC / NVEncC / VCEEncC) はエンコーダ側にコーデックタグを指定する手段が無いため、
  後段の ffmpeg remux (`-c:v copy -tag:v hvc1`) で付ける
- **HEVC は Main プロファイル・8bit 4:2:0 に固定する**。Main10 は端末世代によってハードウェアデコードできない
  (地上波・BS/CS は元が 8bit なので Main で足りる)
- **H.264 は 720p 以上で High プロファイル**、レベルは解像度に応じて設定される (1080p で 4.1)。
  4K の H.264 は iOS のハードウェアデコード対象外なので、`2160p` を使うなら `codecs: [hevc]` にすること

MPEG-TS セグメントをディスクへ書き出す従来方式で運用したい場合は、`stream.profiles.recorded.*` を
手書きする (`cmd` に `%streamFileDir%` を含めるとディスク方式になる)。

#### ビットレートと速度プリセット

映像ビットレートは**画質優先**の値にしてある (H.264 基準)。HEVC は同じ画質をより低いビットレートで
出せるため、内部で 0.65 倍した値が使われる。

| quality | 解像度 | H.264 | HEVC | 音声 |
| ------- | ------ | ----- | ---- | ---- |
| 2160p   | 2160   | 24000 kbps | 15600 kbps | 256 kbps |
| 1080p   | 1080   | 8000 kbps  | 5200 kbps  | 256 kbps |
| 720p    | 720    | 4500 kbps  | 2900 kbps  | 192 kbps |
| 480p    | 480    | 2000 kbps  | 1300 kbps  | 128 kbps |
| 240p    | 240    | 1000 kbps  | 700 kbps   | 96 kbps  |

速度プリセットは用途で変わる。ライブ視聴は遅延がそのまま体感を損なうので速度優先、
録画済みファイルの配信は 1 段重いプリセットにして画質を優先する
(録画中ファイルの配信は実況と合わせて見るため低遅延側のまま)。

| 用途 | ソフトウェア | QSVEncC | NVEncC | VCEEncC |
| ---- | ------------ | ------- | ------ | ------- |
| ライブ視聴 / 録画中ファイル | `-preset veryfast` + `-tune zerolatency` 系 | `--quality faster` | `--preset P3` | `--preset fast` |
| 録画済みファイル | `-preset faster` (`-tune` なし) | `--quality balanced` | `--preset P5` | `--preset balanced` |

帯域や CPU 負荷を抑えたい場合は `codecs: [hevc]` にするか、1 段下の quality を使うこと。

#### 音声トラックの切り替え

再生中に音声トラックを切り替えられる。ストリーム API のクエリ `audioTrack` で指定する。

| 値 | 意味 |
| -- | ---- |
| `main` (既定) | 主音声 |
| `sub` | デュアルモノラル (二か国語放送) の副音声 |
| 数字 | 音声 ES のインデックス (0 始まり) |

`cmd` の中では 2 つのプレースホルダとして展開される。

- `%DUALMONOMODE%` → `-dual_mono_mode main` または `-dual_mono_mode sub` (**入力オプションなので `-i` より前に置く**)
- `%AUDIOMAP%` → 音声 ES を指定したときだけ `-map 0:v:0 -map 0:a:<n>` (出力オプション)

> **注意**: `-dual_mono_mode main` を直書きした手書きの `cmd` では音声を切り替えられない
> (置換対象が無いだけで再生自体は従来どおり動く)。切り替えたい場合は `%DUALMONOMODE%` へ置き換えること。
> `-map 0` を使う `cmd` (m2ts / m2ts-ll / ディスク方式の HLS) に `%AUDIOMAP%` を入れてはいけない
> (map 指定が二重になる)。

録画ファイルの音声トラック一覧は `GET /api/videos/{videoFileId}/audio-tracks` で取得できる。
**音声 ES が 1 本のステレオは主音声・副音声の 2 件へ展開される** (ffprobe からは二か国語放送か
ただのステレオ放送かを判別できないため)。ライブ視聴は事前に構成が分からないので、
Web UI が主音声・副音声の 2 択を常に表示する。

**優先順位 (手書き優先)**: `encode` 配列、`stream.profiles.live`、`stream.profiles.recorded.ts`、
`stream.profiles.recorded.encoded` はそれぞれ独立した単位で判定され、1 件でも手書きの設定が
既にあるセクションには自動生成を行わない (上書きしない)。旧形式 (`stream.live` / `stream.recorded`)
に手書きの設定がある場合も、対応する新形式セクションへは生成しない (新形式が優先されて
旧形式の設定が無視されてしまうのを防ぐため)。

```yaml
# Intel QSV で H.264 / HEVC の 1080p / 720p をすべての用途に対して有効化する例
encodePresets:
    hwaccel: qsv
    codecs: [h264, hevc]
    qualities: [1080p, 720p]
    targets: [recorded, liveHLS, recordedStreaming]
```

### encode

#### エンコード設定

| 子プロパティ名 | 種類               | 必須 | 説明                                                         |
| -------------- | ------------------ | ---- | ------------------------------------------------------------ |
| id             | string             | no   | プリセットを一意に識別する id (省略時は name を id とみなす) |
| name           | string             | yes  | Web インターフェイス上で表示される名称                       |
| cmd            | string             | yes  | 実行するコマンド                                             |
| suffix         | string             | no   | 出力ファイルに付加される拡張子                               |
| rate           | number             | no   | 録画時間 \* rate 後にタイムアウトする ( デフォルト値は 4.0 ) |
| video          | 映像設定プロパティ | no   | クライアント表示用の参考情報 (下記参照)                      |
| audio          | 音声設定プロパティ | no   | クライアント表示用の参考情報 (下記参照)                      |

- `suffix` を定義しなければ、非エンコードコマンドとして実行される
- `id` を省略すると `name` がそのまま識別子として扱われるため、**`name` (表示名) をリネームすると
  録画予約やクライアントに保存済みの設定が無効になる**。運用中に表示名を変更する可能性がある場合は
  `id` を明示的に指定しておくことを推奨する
- `video` / `audio` の子プロパティは `stream.profiles` の映像設定プロパティ・音声設定プロパティ (下記参照) と同じ形式
- `cmd` 内で置換される変数は以下の通り

| 変数名   | 説明                    |
| -------- | ----------------------- |
| %NODE%   | node のファイルパス     |
| %INPUT%  | 入力ファイルパス        |
| %OUTPUT% | 出力ファイルパス        |
| %ROOT%   | EPGStation の root パス |

- 実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                                                                          |
| ---------------------- | -------------- | ----------------------------------------------------------------------------- |
| RECORDEDID             | number         | recorded id                                                                   |
| INPUT                  | string         | 入力ファイルパス                                                              |
| OUTPUT                 | string         | 出力ファイルパス                                                              |
| FFMPEG                 | string         | ffmpeg パス                                                                   |
| FFPROBE                | string         | ffprobe パス                                                                  |
| DIR                    | string         | 予約時に設定した directory 文字列                                             |
| SUBDIR                 | string \| null | サブディレクトリ文字列                                                        |
| NAME                   | string         | 番組名                                                                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                                                                  |
| DESCRIPTION            | string \| null | 番組概要                                                                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                                                                |
| EXTENDED               | string \| null | 番組詳細                                                                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                                                                |
| VIDEOTYPE              | string \| null | "mpeg2" \| "h.264" \| "h.265"                                                 |
| VIDEORESOLUTION        | string \| null | "240p" \| "480i" \| "480p" \| "720p" \| "1080i" \| "2160p" \| "4320p" \| null |
| VIDEOSTREAMCONTENT     | number \| null | video streamType                                                              |
| VIDEOCOMPONENTTYPE     | number \| null | video componentType                                                           |
| AUDIOSAMPLINGRATE      | number \| null | 16000 \| 22050 \| 24000 \| 32000 \| 44100 \| 48000                            |
| AUDIOCOMPONENTTYPE     | number \| null | audio componentType                                                           |
| CHANNELID              | number         | ChannelId mirakurun:40772/api/services で ID を確認できる                     |
| CHNNELNAME             | string         | チャンネル名                                                                  |
| HALF_WIDTH_CHANNELNAME | string         | チャンネル名 (半角)                                                           |
| GENRE1                 | number         | genre1                                                                        |
| GENRE2                 | number         | genre2                                                                        |
| GENRE3                 | number         | genre3                                                                        |
| SUBGENRE1              | number         | sub genre1                                                                    |
| SUBGENRE2              | number         | sub genre2                                                                    |
| SUBGENRE3              | number         | sub genre3                                                                    |
| START_AT               | number         | 番組開始時刻                                                                  |
| END_AT                 | number         | 番組終了時刻                                                                  |
| DROPLOG_ID             | number \| null | ドロップログ id                                                               |
| DROPLOG_PATH           | string \| null | ドロップログファイルパス                                                      |
| ERROR_CNT              | number \| null | エラーカウント                                                                |
| DROP_CNT               | number \| null | ドロップカウント                                                              |
| SCRAMBLING_CNT         | number \| null | スクランブルカウント                                                          |

```yaml
encode:
    - name: H.264
      cmd: '%NODE% %ROOT%/config/enc.js'
      suffix: .mp4
      rate: 4.0
```

- `id` / `video` / `audio` を指定する例 (`name` をリネームしても録画予約やクライアント保存済み設定が壊れない)

```yaml
encode:
    - id: h264-1080p
      name: H.264 (1080p)
      cmd: '%NODE% %ROOT%/config/enc.js'
      suffix: .mp4
      rate: 4.0
      video:
          codec: libx264
          height: 1080
          bitrate: 3000
      audio:
          codec: aac
          bitrate: 192
```

---

## 視聴設定

### streamingPriority

#### ストリーミング視聴時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
streamingPriority: 1
```

### urlscheme

#### 視聴 URL Scheme 設定

| 子プロパティ名 | 種類         | 必須 | 説明                                       |
| -------------- | ------------ | ---- | ------------------------------------------ |
| m2ts           | 孫プロパティ | no   | m2ts 形式視聴時の URL Scheme 設定          |
| video          | 孫プロパティ | no   | 録画ビデオ視聴時の URL Scheme 設定         |
| download       | 孫プロパティ | no   | 録画ビデオダウンロード時の URL Scheme 設定 |

| 孫プロパティ名 | 種類   | 必須 | 説明                                                  |
| -------------- | ------ | ---- | ----------------------------------------------------- |
| ios            | string | no   | iOS の URL Scheme 設定                                |
| android        | string | no   | Android の URL Scheme 設定                            |
| mac            | string | no   | [Mac の URL Scheme 設定](./mac-url-scheme.md)         |
| win            | string | no   | [Windows の URL Scheme 設定](./windows-url-scheme.md) |

- 設定内で置換される変数は以下の通り

| 変数名   | 説明                           |
| -------- | ------------------------------ |
| PROTOCOL | プロトコル                     |
| ADDRESS  | EPGStation の MPEG-TS 配信 URL |
| FILENAME | 出力されるファイル名           |

```yaml
urlscheme:
    m2ts:
        ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS"'
        android: 'intent://ADDRESS#Intent;package=org.videolan.vlc;type=video;scheme=PROTOCOL;end'
    video:
        ios: 'infuse://x-callback-url/play?url=PROTOCOL://ADDRESS'
        android: 'intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=PROTOCOL;end'
    download:
        ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS'
```

### streamFilePath

#### HLS 配信時に使用される一時領域

| 種類   | デフォルト値                                                                                 | 必須 |
| ------ | -------------------------------------------------------------------------------------------- | ---- |
| string | hoge/EPGStation/data/streamfiles (EPGStation 直下の data/streamfiles ディレクトリのフルパス) | no   |

```yaml
'streamFilePath': '/tmp/hlsfile'
```

### stream

#### ストリーミング設定

| 子プロパティ名 | 種類               | 必須 | 説明                       |
| -------------- | ------------------ | ---- | -------------------------- |
| live           | ライブプロパティ   | no   | ライブストリーミング設定   |
| recorded       | 録画番組プロパティ | no   | 録画番組ストリーミング設定 |

- ライブプロパティは以下の通り

| ライブプロパティ名 | 種類                           | 必須 | 説明                    |
| ------------------ | ------------------------------ | ---- | ----------------------- |
| ts                 | ライブストリーミングプロパティ | no   | m2ts ストリーミング設定 |

- 録画番組プロパティは以下の通り

| ライブプロパティ名 | 種類                         | 必須 | 説明                                   |
| ------------------ | ---------------------------- | ---- | -------------------------------------- |
| ts                 | 録画ストリーミングプロパティ | no   | m2ts ストリーミング設定                |
| encoded            | 録画ストリーミングプロパティ | no   | エンコード済みビデオストリーミング設定 |

- ライブストリーミングプロパティは以下の通り

| ライブストリーミングプロパティ名 | 種類               | 必須 | 説明                              |
| -------------------------------- | ------------------ | ---- | --------------------------------- |
| m2ts                             | コマンドプロパティ | no   | m2ts コマンド設定                 |
| m2tsll                           | コマンドプロパティ | no   | m2tsll コマンド設定 (mpegts.js)用 |
| webm                             | コマンドプロパティ | no   | webm コマンド設定                 |
| mp4                              | コマンドプロパティ | no   | mp4 コマンド設定                  |
| hls                              | コマンドプロパティ | no   | hls コマンド設定                  |

- 録画ストリーミングプロパティは以下の通り

| 録画ストリーミングプロパティ名 | 種類               | 必須 | 説明              |
| ------------------------------ | ------------------ | ---- | ----------------- |
| webm                           | コマンドプロパティ | no   | webm コマンド設定 |
| mp4                            | コマンドプロパティ | no   | mp4 コマンド設定  |
| hls                            | コマンドプロパティ | no   | hls コマンド設定  |

- コマンドプロパティは以下の通り

| 録画ストリーミングプロパティ名 | 種類   | 必須 | デフォルト値 | 説明                                   |
| ------------------------------ | ------ | ---- | ------------ | -------------------------------------- |
| name                           | string | yes  | -            | Web インターフェース上で表示される名前 |
| cmd                            | string | no   | -            | 変換コマンド                           |

- `cmd` が指定されない場合は無変換配信
- `cmd` に `|` を含めるとシェル経由 (Windows: cmd.exe / その他: /bin/sh) で実行される (tsreadex などの前処理用)
- ライブ HLS (`live.ts.hls`) の `cmd` が `%streamFileDir%` を含まない場合は、fragmented MP4 を標準出力へ書き出す in-memory 配信モードとなり、ディスクに一時ファイルを作成しない (低遅延・字幕非対応。詳細は `doc/streaming-refresh.md`)
- `cmd` で置換される変数は以下の通り

| 変数名          | 説明                                            |
| --------------- | ----------------------------------------------- |
| %FFMPEG%        | EPGStation が利用している ffmpeg のパス         |
| %TSREADEX%      | config の `tsreadex` で指定した tsreadex のパス |
| %streamFileDir% | `streamFilePath` で指定したパス名               |
| %streamNum%     | 一時ファイルのストリーム番号                    |
| %SS%            | 読み取り位置(秒)                                |
| %SPACE%         | 半角スペース                                    |

```yaml
stream:
    live:
        ts:
            m2ts:
                - name: 720p
                  cmd: '%FFMPEG% -re -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2
                      -c:v libx264 -vf yadif,scale=-2:720 -b:v 3000k -preset veryfast -y -f mpegts pipe:1'
                - name: 無変換

            webm:
                - name: 720p
                  cmd:
                      '%FFMPEG% -re -dual_mono_mode main -i pipe:0 -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 192k -ac
                      2 -c:v libvpx-vp9 -vf yadif,scale=-2:720 -b:v 3000k -deadline realtime -speed 4 -cpu-used -8 -y -f
                      webm pipe:1'
    recorded:
        ts:
            mp4:
                - name: 720p
                  cmd: '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v
                      libx264 -vf yadif,scale=-2:720 -b:v 3000k -profile:v baseline -preset veryfast -tune
                      fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4
                      pipe:1'
        encoded:
            hls:
                - name: 720p
                  cmd: '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -ignore_unknown
                      -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1
                      -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a
                      aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf scale=-2:720 -b:v 3000k -preset veryfast -flags
                      +loop-global_header %OUTPUT%'
```

特定の配信方式を無効化したい場合は以下の例のように空配列を定義すること

例): ライブ視聴の m2ts 配信方式を無効化する場合

```yaml
stream:
    live:
        ts:
            m2ts: []
```

- (旧形式の暗黙仕様) 配信 API (`/api/streams/...`) の `mode` クエリパラメータは、上記配列の **index** (0 始まり) を指定する。
  例えば `stream.live.ts.hls` に `1080p` / `720p` / `480p` / `無変換` の順で 4 件定義した場合、`mode=0` は `1080p`、
  `mode=3` は `無変換` を指す。この対応関係は Web UI が `GET /api/config` の `streamConfig` (各エントリの `name` のみを
  表示名として並べた配列) を使って自動的に構築するため、通常は意識する必要はない

### stream.profiles (新形式)

#### id ベースの配信プリセット設定

上記の `stream.live` / `stream.recorded` (旧形式) の代わりに、id を持つ配信プリセットとして定義できる新形式。
旧形式と併存可能で、同じスコープ (`live` / `recorded.ts` / `recorded.encoded` 単位) に新形式が定義されている場合は
そちらが優先され、旧形式は無視される (スコープ単位の切り替えのため、live だけ新形式にして recorded は旧形式のまま、
という混在も可能)

`live` / `recorded.ts` / `recorded.encoded` を手書きせず、`encodePresets` (前述) の一括有効化フラグから
自動生成することもできる。各セクションに手書きの設定 (この新形式・旧形式のいずれか) が既にある場合は
そちらが優先され、自動生成は行われない

| 子プロパティ名 | 種類                         | 必須 | 説明                           |
| -------------- | ---------------------------- | ---- | ------------------------------ |
| live           | 配信プリセット配列           | no   | ライブ配信の配信プリセット一覧 |
| recorded       | 録画配信プリセットプロパティ | no   | 録画配信の配信プリセット設定   |

- 録画配信プリセットプロパティは以下の通り

| プロパティ名 | 種類               | 必須 | 説明                                       |
| ------------ | ------------------ | ---- | ------------------------------------------ |
| ts           | 配信プリセット配列 | no   | 元 TS ファイルの配信プリセット一覧         |
| encoded      | 配信プリセット配列 | no   | エンコード済みファイルの配信プリセット一覧 |

- 配信プリセット (StreamProfile) は以下の通り

| プロパティ名  | 種類               | 必須 | デフォルト値 | 説明                                                              |
| ------------- | ------------------ | ---- | ------------ | ----------------------------------------------------------------- |
| id            | string             | yes  | -            | プリセットを一意に識別する id。`?profile=` クエリで指定する       |
| name          | string             | yes  | -            | Web インターフェース上で表示される名前                            |
| container     | string             | yes  | -            | `m2ts` \| `m2tsll` \| `mp4` \| `webm` \| `hls`                    |
| video         | 映像設定プロパティ | no   | -            | 省略した場合、他に `audio` も無ければ無変換扱いとなる             |
| audio         | 音声設定プロパティ | no   | -            | 省略した場合、他に `video` も無ければ無変換扱いとなる             |
| cmd           | string             | no   | -            | 変換コマンド。指定した場合 `video` / `audio` の内容より優先される |
| isUnconverted | boolean            | no   | -            | 無変換か (通常は自動判定されるため明示指定は不要)                 |

- 映像設定プロパティ (video) は以下の通り

| プロパティ名 | 種類   | 必須 | 説明                                             |
| ------------ | ------ | ---- | ------------------------------------------------ |
| codec        | string | no   | 映像コーデック (省略時 container に応じた既定値) |
| width        | number | no   | 出力幅 (省略時アスペクト比を保持)                |
| height       | number | no   | 出力高さ (省略時アスペクト比を保持)              |
| bitrate      | number | no   | ビットレート (kbps)                              |

- 音声設定プロパティ (audio) は以下の通り

| プロパティ名 | 種類   | 必須 | 説明                                             |
| ------------ | ------ | ---- | ------------------------------------------------ |
| codec        | string | no   | 音声コーデック (省略時 container に応じた既定値) |
| bitrate      | number | no   | ビットレート (kbps)                              |

- `cmd` / `video` / `audio` をすべて省略した場合は無変換配信となる (旧形式の `cmd` 省略時と同じ挙動)
- `cmd` を省略し `video` / `audio` のいずれかを指定した場合、`container` と合わせて ffmpeg コマンドを自動生成する。
  自動生成されるコマンドで使われるプレースホルダは旧形式と同じ (`%FFMPEG%` `%INPUT%` `%OUTPUT%` `%SS%` `%streamFileDir%` `%streamNum%`)
- `cmd` を明示指定する場合は旧形式と同じプレースホルダ規約に従うこと

```yaml
stream:
    profiles:
        live:
            - id: live-hls-1080p
              name: 1080p (HLS)
              container: hls
              video:
                  codec: libx264
                  height: 1080
                  bitrate: 3000
              audio:
                  codec: aac
                  bitrate: 192
            - id: live-hls-unconverted
              name: 無変換 (HLS)
              container: hls
        recorded:
            ts:
                - id: recorded-ts-mp4-720p
                  name: 720p
                  container: mp4
                  video:
                      height: 720
                      bitrate: 3000
            encoded:
                - id: recorded-encoded-mp4-720p
                  name: 720p
                  container: mp4
                  video:
                      height: 720
                      bitrate: 3000
```

- 配信 API を新形式のプリセットで呼び出す場合は `?profile={id}` クエリを指定する (例: `?profile=live-hls-1080p`)。
  `mode` / `profile` のどちらも指定しない場合は 400 応答となる

### kodiHosts

#### kodi への配信時に使用するオプション

| 種類               | デフォルト値           | 必須 |
| ------------------ | ---------------------- | ---- |
| 子プロパティの配列 | 下記デフォルト値を参照 | no   |

- 子プロパティは以下の通り

| 子プロパティ名 | 種類   | 必須 | 説明                                   |
| -------------- | ------ | ---- | -------------------------------------- |
| name           | string | yes  | Web インターフェイス上で表示される名前 |
| host           | string | yes  | kodi が動作しているホストの URL        |
| user           | string | no   | kodi のユーザー名                      |
| password       | string | no   | kodi のパスワード                      |

```yaml
kodiHosts:
    - name: kodi1
      host: http://xxx.xxx.xxx.xxx:8080
    - name: kodi2
      host: http://xxx.xxx.xxx.xxx:8080
      user: kodi
      password: pas
```

[kodi.md](./kodi.md)
