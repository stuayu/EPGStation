# Windows 用 セットアップマニュアル

本マニュアルでは、Windows 環境におけるセットアップ手順を解説します

**なお、Windows 版は現時点で実験的であり、安定動作を保証するものではありません  
また、今後のアップデート等で非対応となる可能性があります**

本マニュアル内では、以下のソフトウェアを利用したセットアップを行います

- [TeraPad](http://www5f.biglobe.ne.jp/~t-susumu/), [VSCode](https://code.visualstudio.com/) など
    - config.yml 等のファイルを編集するため
    - Windows 標準のメモ帳では正しく改行されません
- [Git for Windows](https://git-for-windows.github.io/)
    - EPGStation をアップデートするときに便利です
- Windows PowerShell もしくは コマンドプロンプト

## セットアップ

ここでは Windows PowerShell を用いたセットアップを解説します

1. **Node.js (LTS 版推奨), Mirakurun, windows-build-tools, FFmpeg/FFprobe** がインストール済みであることを確認する

    ```
    > node --version
    > Invoke-WebRequest http://<MirakurunIP>:<Port>/api/version
    > npm info windows-build-tools
    ```

    FFmpeg/FFprobe については config.yml でファイルの場所を指定するので適切な場所に配置すること

2. EPGStation のインストール

    ```
    > git clone https://github.com/l3tnun/EPGStation.git
    > cd EPGStation
    > npm run all-install
    > npm run build

    ```

    `mirakurun` は GitHub リポジトリを git 参照 (`git+https://...#<タグ>`) で固定しているため、npm の依存元制限
    (`allow-git`) が許可されていないと `npm run all-install` が失敗します。
    リポジトリの `.npmrc` で `allow-git=all` を設定済みですが、それでも失敗する場合は
    環境変数で明示してください

    ```
    > $env:NPM_CONFIG_ALLOW_GIT="all"
    > npm run all-install
    ```

3. 設定ファイルの作成

    **この手順は省略できます。** 用意されていない場合は初回起動時に
    テンプレート (`*.template` / `*.sample.yml`) から自動生成されます。
    先に内容を確認・編集しておきたい場合のみ実行してください。

    ```
    > copy .\config\config.yml.template .\config\config.yml
    > copy .\config\operatorLogConfig.sample.yml .\config\operatorLogConfig.yml
    > copy .\config\epgUpdaterLogConfig.sample.yml .\config\epgUpdaterLogConfig.yml
    > copy .\config\serviceLogConfig.sample.yml .\config\serviceLogConfig.yml
    > copy .\config\enc.js.template .\config\enc.js
    ```

4. 設定ファイルの編集

    - 詳細な設定は [詳細マニュアル](conf-manual.md) を参照
    - 以下の最低限の動作に必須な項目について編集する

    ```yaml
    port: 8888,
    mirakurunPath: 'http://localhost:40772'
    ffmpeg: 'C:\\ffmpeg\\ffmpeg.exe'
    ffprobe: 'C:\\ffmpeg\\ffprobe.exe'
    ```

    - Mirakurun について、名前付きパイプを使用するなら `\\\\.\\pipe\\mirakurun`

## EPGStation の起動/終了

- 手動で起動する場合

    ```
    > npm start
    ```

- 自動で起動する場合

    - [node-windows](https://github.com/coreybutler/node-windows) を利用して自動起動設定が可能です
    - **node-windows はグローバルインストールしたものを link して使います**

        ```
        > npm install -g node-windows
        > npm link node-windows
        ```

    - その上で、以下のコマンドを**管理者権限**で実行するとサービス化できます

        ```
        > npm run install-win-service
        > net start epgstation
        ```

    - 実行中に**サービスを動かすユーザー名とパスワード**を聞かれます。既定はログオン中のユーザーで、そのまま Enter を押せば構いません (パスワードの入力は伏せ字になり、Windows のサービス設定へ渡す以外の用途には使いません)
        - **ログインしているユーザーの権限でサービスを動かします**。LocalSystem では録画先のネットワーク共有 (UNC パス) やユーザー環境に置いた設定・実行ファイルへ手が届かず、`git` もリポジトリの所有者と一致しないためです
        - Microsoft アカウントでサインインしていてパスワードを持たない場合は、ローカルアカウントに切り替えてパスワードを設定してから実行してください。どうしても LocalSystem で動かす場合は `--system` を付けます
        - 指定したアカウントには**録画先・ログ出力先への書き込み権限**が必要です (「サービスとしてログオン」権限は登録時に自動で付与されます)

        ```
        > node scripts/win-service.js install --user=".\<ユーザー名>"
        > node scripts/win-service.js install --system
        ```

    - サービスの登録に加えて、サービスとして動かすために必要な設定を行います (`scripts/win-service.js`)
        1. サービス専用の環境変数 `Path` に node / git と、`config.yml` に絶対パスで書かれた ffmpeg / ffprobe / tsreadex 等のディレクトリを追加 (サービスは**ユーザースコープの PATH を参照できない**ため、これが無いと git やエンコーダが見つかりません)
        2. `git config --system --add safe.directory <EPGStation のパス>` の登録 (リポジトリの所有者と実行アカウントが違うと `dubious ownership` で git が全て失敗します)
        3. プロセスが終了したときの自動再起動 (ワンクリック更新はプロセスを終了して入れ替わる方式のため必須です)
        4. ワンクリック更新が参照する環境変数 (`EPGSTATION_SERVICE_MANAGER` / `EPGSTATION_WIN_SERVICE_NAME`)

    - 登録状況と、サービスから見える node / git / PATH を確認できます (管理者権限は不要です)

        ```
        > npm run status-win-service
        ```

    - 1 台で複数の EPGStation を動かす場合は `--name` でサービスの表示名を変えられます。アンインストール・状況確認でも同じ `--name` を渡してください

        ```
        > node scripts/win-service.js install --name="EPGStation Sub"
        > node scripts/win-service.js uninstall --name="EPGStation Sub"
        > node scripts/win-service.js status --name="EPGStation Sub"
        ```

    - **winser を使って登録していた場合は先に解除してください**。サービス名が同じ (`epgstation`) ため、残っていると登録に失敗します

        ```
        > npm install winser -g
        > winser -r -x
        ```

- 手動で終了する場合

    ```
    > npm stop
    ```

- 自動起動した EPGStation を終了する場合

    ```
    > net stop epgstation
    ```

    - サービスから削除する場合は以下のコマンドを管理者権限で実行します

    ```
    > npm run uninstall-win-service
    ```

## Tips

### サービスとして動かしているときにワンクリック更新が失敗する

Web UI の「更新」タブからの更新は git と npm を実行します。まず `npm run status-win-service` で
サービスから git が見えているかを確認してください。症状ごとの原因は次のとおりです。

- `EPERM, Permission denied: ...\dist` (`npm run clean` で失敗する) — 実行中のサービス本体を消そうとしています。以前のバージョンはサービスの実体を `dist\daemon` に置いていたためで、`npm run uninstall-win-service` → `npm run install-win-service` で登録し直すと `daemon` がリポジトリ直下へ移り解消します (残った `dist\daemon` は手動で削除してください)
- `CommandFailed: git (spawn git ENOENT)` — サービスの PATH に git がありません。Git for Windows を「すべてのユーザー」向けに入れ直してから、サービスを登録し直してください
- `detected dubious ownership in repository` — リポジトリの所有者とサービスの実行アカウントが違います。`git config --system --add safe.directory <EPGStation のパス (区切りは /)>` を管理者権限で実行してください
- 更新後にサービスが起き上がらない — winser で登録したままの可能性があります。`npm run status-win-service` に `(winser / nssm 由来)` と出る場合は `winser -r -x` で解除し、`npm run install-win-service` で登録し直してください

### ファイアウォールの設定

EPGStation を別のコンピュータから使用する場合はファイアウォールを開放してください

### パス名区切り文字

unix 系では `/` を使用するため \*.sample.json では `/hoge/huga/piyo` と書かれていますが、windows では
`\\hoge\\huga\\piyo` このように書いてください

### config.yml

#### encode

enc.js へのファイルパスを修正してください。

```
encode:
    - name: H.264
      cmd: '%NODE% %ROOT%/config/enc.js'
      suffix: .mp4
      rate: 4.0
```

## MySQL 使用時の注意

EPGStation 使用中は MySQL のバイナリログが大量に生成されてディスクを圧迫するので、MySQL の設定 (my.ini) を変えることを推
奨します

```
expire_logs_days = 1
```
