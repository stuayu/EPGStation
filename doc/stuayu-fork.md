# このフォークプロジェクトについて
このフォーク版EPGStationを利用するには[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)が必要です．．  
[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)は本家EPGStation環境下でも多分動作すると思いますが保証しません．
変更点などはコミットログや[変更箇所](#変更箇所)をご覧ください．

# windows用 mirakurun-epgstation セットアップガイド

- [このフォークプロジェクトについて](#このフォークプロジェクトについて)
- [windows用 mirakurun-epgstation セットアップガイド](#windows用-mirakurun-epgstation-セットアップガイド)
  - [Mirakurunインストール編](#mirakurunインストール編)
  - [EPGStationインストール編](#epgstationインストール編)
  - [変更箇所](#変更箇所)

## Mirakurunインストール編

公式版と一部改変版のMirakrunの導入について解説します.  
事前準備としてNodejs-LTSをインストールしてください．  
おすすめは[chocolatey](https://chocolatey.org/)をインストールしてから以下のコマンドを実行する方法です．  

  ```powershell
  choco install nodejs-lts --version=16.19.0
  ```

- 公式版Mirakurunを導入する
  
  1. インストールを実行する．
   `npm install mirakurun@latest -g --foreground-scripts --production`
  2. 各種設定ファイルの編集
   チューナー・サーバ・チャンネルの設定ファイル：`%USERPROFILE%\.Mirakurun`  
   サービスの**LOGデータ**・Logoデータ・番組情報・チャンネル情報の保存先：`%localappdata%\Mirakurun`  
   エクスプローラーのアドレスバーに上記をコピペすると一瞬で移動できます．  
   チューナー・チャンネル設定は**必須**です．適宜，vscodeなどのテキストエディタで編集してください．  
   なお，アクセスできない・起動しないなどのトラブルが発生した場合，**Logデータを確認すると問題が発生している箇所がわかります．**
  3. ブラウザでアクセスする．
   `http://127.0.0.1:40772`で起動しています．また，`http://localhost:40772`でアクセスした場合表示されない可能性があります．

- フォーク版Mirakurunを導入する
  1. ビルドの実行  
    powershellで実行してください．

        ```powershell
        cd Mirakurun
        npm install
        npm run build
        ```

  2. インストールの実行  
    正常に動作するか確認する場合は，`npm run start.win32`を実行してください．

        ```powershell
        npm run postinstall -g # 管理者権限必須(windowsのサービスへ登録)
        ```
        もしサービスのインストールに失敗した場合は，管理者権限で`SC stop mirakurun`と`SC delete mirakurun`を実行してから再びサービスのインストールを行ってください．

  3. 各種設定ファイルの編集  
    チューナー・サーバ・チャンネルの設定ファイル：`Mirakurun\local_config`  
    サービスの**LOGデータ**・Logoデータ・番組情報・チャンネル情報の保存先：`Mirakurun\local_data`  
  4. ブラウザからアクセスする  
    `http://127.0.0.1:40772` or `http://localhost:40772`でアクセスできます．  
    アクセスできない場合はMirakurunのログを確認してください，起動できない理由が書いてあるはずです．

## EPGStationインストール編

基本的には公式と一緒の手順です．一部Mirakurunを改変しているため，node_module内に再配置が必要になります．  
改変前のEPGStationで実行したバックアップはルール予約のみ互換性がありません．手動でバックアップファイル内の予約データの箇所を削除するか，  
GR,BS,CSの箇所をNW1~20のチャンネル空間を追加することで正常にリストアできます．  
過去すでにMySQL(MariaDB)などを利用していた場合には，テーブルをドロップして再びテーブルを作成してください．

  1. ビルドの実行

        ```powershell
        cd EPGStation
        npm run all-install
        cp ../Mirakurun ./node_modules/mirakurun -Recurse -Force #これをしないと一部機能が動作しません．
        npm run build
        ```

  2. 設定ファイルの編集  
    `config`フォルダ内に配置されているyamlファイルを各自にあった，設定ファイルに変更してください．
  3. Windowsサービスとして登録  

        ```powershell
        npm run install-win-service # 管理者権限必須
        ```
        エラーが起きた場合は管理者権限で`SC stop epgstation`と`SC delete epgstation`を実行してください．
   4. MariaDBのインストール
      1. epgstationテーブルのセットアップ
            ```powershell
            choco install mariadb
            ```
      2. epgstationテーブルへのアクセス権設定
            ```powershell
            mysql -u root -e 'CREATE DATABASE epgstation CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;'
            mysql -u root -e 'CREATE USER "epgstation"@"localhost" IDENTIFIED BY "epgstation";'
            mysql -u root -e 'GRANT ALL ON epgstation.* TO "epgstation"@"localhost";'
            ```
## 変更箇所

- **Mirakurun/EPGStation**
  - 県境でよくある複数の県外地上波を扱うことができるようにGR/BS/CS/SKYを拡張し，新たにNW1~NW20まで追加
  - Node.js LTS v18系でのインストールに暫定対応
  - 各フォーク版MirakurunとEPGStationのビルドが成功するかどうか確認するためのワークフローをActionsに追加
- **Mirakurun**
  - Windowsでlocalhost:40772または，[::1]:40772でアクセスできない問題の修正
- **EPGStation**
  - 本家EPGStationへのプルリクエストとissueで報告されていたバグ修正のマージ
    - Hotfix: IPTV Simple Client is very slow. l3tnun/EPGStation#614
    - ドロップログ上のパケット数が m2ts ファイル上での実際の数よりも少ない l3tnun/EPGStation#603
