# このフォークプロジェクトについて
このフォーク版EPGStationを利用するには[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)が必要です。  
[フォーク版Mirakurun](https://github.com/stuayu/Mirakurun)は本家EPGStation環境下でも多分動作すると思いますが保証しません。
変更点などはコミットログや[変更箇所](#変更箇所)をご覧ください。

# windows用 mirakurun-epgstation セットアップガイド

- [このフォークプロジェクトについて](#このフォークプロジェクトについて)
- [windows用 mirakurun-epgstation セットアップガイド](#windows用-mirakurun-epgstation-セットアップガイド)
  - [Mirakurunインストール編](#mirakurunインストール編)
  - [EPGStationインストール編](#epgstationインストール編)
  - [変更箇所](#変更箇所)

## Mirakurunインストール編

改変版のMirakrunの導入について解説します.  
事前準備としてNodejs-LTSをインストールしてください。  
~~おすすめは[chocolatey](https://chocolatey.org/)をインストールしてから以下のコマンドを実行する方法です。~~   
Windows10/11から標準で利用可能になったwingetでインストールすることをお勧めします。  
公式サイトからのインストールでも動作します。   

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

- フォーク版Mirakurunを導入する
  1. [Github](https://github.com/stuayu/Mirakurun)からソースコードをクローンし、ビルドを行う。
        ```powershell
        git clone https://github.com/stuayu/Mirakurun -b dev
        cd Mirakurun
        npm install
        npm run build
        ``` 
  2. 各種設定ファイルの編集  
    チューナー・サーバ・チャンネルの設定ファイル：`Mirakurun\local_config`  
    サービスの**LOGデータ**・Logoデータ・番組情報・チャンネル情報の保存先：`Mirakurun\local_data`  
    新規インストール時`local_data`フォルダ内のデータを削除することをお勧めします。

  3. サービスとして登録
        ```powershell
        npm run postinstall -g # 管理者権限で実行する
        ```

  4. ブラウザからアクセスする  
    `http://127.0.0.1:40772` or `http://localhost:40772`でアクセスできます。  
    アクセスできない場合はMirakurunのログを確認してください、起動できない理由が書いてあるはずです。
  5. Mirakurunの削除方法
        ```powershell
        npm run preuninstall -g # 管理者権限で実行する
        ```
        エクスプローラー等でフォルダを削除する。  

## EPGStationインストール編
基本的には公式と一緒の手順です。  
改変前のEPGStationで実行したバックアップはルール予約のみ互換性がありません。手動でバックアップファイル内の予約データの箇所を削除するか、  
GR,BS,CSの箇所をNW1~40のチャンネル空間を追加することで正常にリストアできます。  
過去すでにMySQL(MariaDB)などを利用していた場合には、テーブルをドロップして再びテーブルを作成してください。
  
  0. EPGStationデータベースからバックアップを作成する(データを引き継ぐ場合)
        ```powershell
        npm run backup {今日の日付など}.sql
        ```
        作成された`{今日の日付など}.sql`を保存しておいてください。  
        バックアップが完了したのち、データベースのテーブルを削除しておきます。

  1. [Github](https://github.com/stuayu/EPGStation)からソースコードをクローンし、ビルドを行う。

        ```powershell
        git clone https://github.com/stuayu/EPGStation -b dev
        cd EPGStation
        npm run all-install
        npm run build-win # Windowsの場合のみ実行する
        npm run build # Linux/Macの場合のみ実行する
        ```

  2. 設定ファイルの編集  
    `config`フォルダ内に配置されているyamlファイルを各自にあった、設定ファイルに変更してください。

  3. Windowsサービスとして登録  

        ```powershell
        npm run install-win-service # 管理者権限必須
        ```
        エラーが起きた場合は管理者権限で`SC stop epgstation`と`SC delete epgstation`を実行してください。  
        存在してしまっているサービスを削除することができます。  
   4. MariaDBのインストール
      1. epgstationテーブルのセットアップ
            ```powershell
            winget install MariaDB.Server
            ```
      2. epgstationテーブルへのアクセス権設定（LinuxでもWindowsでも可能）  
         Windows環境の場合、環境変数にmysqlが登録されていない場合は、mysqlが見つからない場合があります。  
         Windows環境ではGUIで設定ができますので、以下の記事を参考に設定を行ってください。  
         https://zenn.dev/stuayu/articles/412f3faf5713a0
            ```powershell
            mysql -u root -e 'CREATE DATABASE epgstation CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;'
            mysql -u root -e 'CREATE USER "epgstation"@"localhost" IDENTIFIED BY "epgstation";'
            mysql -u root -e 'GRANT ALL ON epgstation.* TO "epgstation"@"localhost";'
            ```
      3. バックアップしたデータの復元
            > [!IMPORTANT]
            > バックアップファイルからの復元は、EPGStationがWebから正常にアクセスできることを確認した後に行ってください。

            ```powershell
            npm run restore {今日の日付など}.sql
            ```
            復元作業中に、ruleの部分で失敗する場合は、手動でsqlファイルを修正してください。
## 変更箇所

- **Mirakurun/EPGStation**
  - 県境でよくある複数の県外地上波を扱うことができるようにGR/BS/CS/SKYを拡張し、新たにNW1~NW40まで追加
  - Node.js LTS v18/v20系でのインストール対応
  - 各フォーク版MirakurunとEPGStationのビルドが成功するかどうか確認するためのワークフローをActionsに追加
  - 各種パッケージの更新
- **Mirakurun**
  - Windowsでlocalhost:40772または、[::1]:40772でアクセスできない問題の修正
  - `0.0.0.0`と`::`をリッスンするオプションの追加
  - EPG取得間隔を放送波ごとに指定できるように変更
  - サービスストリームAPI指定時に物理チャンネルやチューナーグループが異なる場合でも、NIDとSIDが同じ場合はチューナーを利用できるように改変(効率よく選局が可能)
- **EPGStation**
  - 本家EPGStationへのプルリクエストとissueで報告されていたバグ修正のマージ
    - Hotfix: IPTV Simple Client is very slow. l3tnun/EPGStation#614
    - ドロップログ上のパケット数が m2ts ファイル上での実際の数よりも少ない l3tnun/EPGStation#603
    - 定期的に本家の変更に追従
  - dev版Mirakurunとの接続に対応