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

    - [node-windows](https://github.com/coreybutler/node-windows) を利用して自動起動設定が可能です (依存に含まれているため追加のインストールは不要です)
    - 以下のコマンドを**管理者権限**で実行するとサービス化できます

        ```
        > npm run install-win-service
        > net start epgstation
        ```

    - `npm run install-win-service` はサービスの登録に加えて、サービスとして動かすために必要な設定を行います (`scripts/win-service.js`)
        1. サービス専用の環境変数 `Path` に node / git と、`config.yml` に絶対パスで書かれた ffmpeg / ffprobe / tsreadex 等のディレクトリを追加 (サービスは**ユーザーの PATH を参照できない**ため、これが無いと git やエンコーダが見つかりません)
        2. `git config --system --add safe.directory <EPGStation のパス>` の登録 (サービスは既定で LocalSystem として動くため、リポジトリの所有者と一致せず `dubious ownership` で git が全て失敗します)
        3. プロセスが終了したときの自動再起動 (ワンクリック更新はプロセスを終了して入れ替わる方式のため必須です)
        4. ワンクリック更新が参照する環境変数 (`EPGSTATION_SERVICE_MANAGER` / `EPGSTATION_WIN_SERVICE_NAME`)
    - **ユーザーアカウントでサービスを動かす場合**は `--user` を付けて実行します。ネットワーク共有 (UNC パス) に録画する場合や、ユーザー環境の設定をそのまま使いたい場合はこちらを使ってください (パスワードは対話で入力できます)

        ```
        > node scripts/win-service.js install --user=".\<ユーザー名>"
        ```

    - 登録状況と、サービスから見える node / git / PATH を確認できます (管理者権限は不要です)

        ```
        > npm run status-win-service
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
