---
name: deploy-production
description: EPGStation の変更を本番サーバ (Windows) へ反映して実機で確認するときに使う。SSH での接続・ビルド・サービス再起動・反映確認の手順と、Windows 特有の落とし穴 (文字化け・引用符・パス) をまとめてある。
---

# 本番反映の手順

本番は **Windows**。macOS/Linux の感覚で組み立てたコマンドはほぼ通らない。

## 反映の流れ

1. **録画中でないことを確認する** (再起動で録画が切れる)
   ```bash
   curl -s "https://<本番>/api/recording?isHalfWidth=false&limit=5"
   ```
2. **ローカルで lint まで通してから push する** — `npm run build` は eslint を含む。
   `npm run compile` と `npm test` は lint を通さないので、これだけでは本番ビルドの成否が分からない
   ```bash
   npm run compile && npm test && npx eslint src && (cd client && npm run build)
   git push origin main
   ```
3. **本番で pull → build**
4. **サービス再起動**
5. **反映を実測で確認する** (バージョン・ログ・実際の配信)

## Windows での実行

SSH 経由の `cmd` は日本語が cp932 で化け、引用符も壊れる。**PowerShell を base64 で渡す**。

```bash
PS=$(cat <<'EOF'
Set-Location "C:\DTV\EPGStation"
git pull --ff-only 2>&1 | Select-Object -Last 5
npm run build 2>&1 | Select-Object -Last 10
EOF
)
B=$(printf '%s' "$PS" | iconv -f UTF-8 -t UTF-16LE | base64)
ssh ayumu@<host> "powershell -NoProfile -EncodedCommand $B"
```

- **`tail` / `head` は無い**。`Select-Object -Last N` / `-First N` を使う
- 出力に `#< CLIXML` と `<Objs Version=...>` が混ざる。grep で落とす
- 警告バナー (`post-quantum`) も毎回出るので落とす

```bash
| grep -v "WARNING\|post-quantum\|store now\|openssh.com\|CLIXML\|Objs Version"
```

## サービス

```powershell
Get-Service | Where-Object { $_.Name -like "*EPGStation*" }   # 名前を確認 (例: epgstation.exe)
Restart-Service -Name "epgstation.exe" -Force
```

**再起動の前後で、EPGStation の node プロセスが 1 系統だけかを必ず確認する。**
`Restart-Service` は、ラッパー (winsw / node-windows) が子プロセスを止められないと、
古いプロセス群を残したまま新しいプロセス群を起動する。古い側が 8888 を掴んだまま古いコードを返し続け、
Operator が 2 つ動いて録画・EPG 更新が二重になる。

```powershell
# 再起動の前: エンコード中なら終わるのを待つ (AmatsukazeEncodeTool などの子を winsw が止められない)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*EPGStation*' } |
  Select-Object ProcessId, ParentProcessId, CreationDate
# 再起動の後: 8888 を持つ PID が、新しく起動した ServiceExecutor の PID か
Get-NetTCPConnection -LocalPort 8888 -State Listen | Select-Object OwningProcess
```

古い系統が残っていたら、サービスを止め、`EPGStation` を含む node (ラッパーの `node-windows\lib\wrapper.js` を含む) をすべて止めてから `Start-Service` する。
Mirakurun の node (`Mirakurun_Proxy` / `Mirakurun_Share`) は巻き込まないこと。
**バージョン API (`/api/version`) だけで反映を判断しない** — 古い系統が応答していても 200 が返る。

## 設定ファイル

- **`config/config.yml` は利用者所有**。git 管理外で、テンプレートを更新しても本番へは反映されない。
  **テンプレートに追加した項目は、本番の config.yml にも別途入れないと有効にならない**
- 書き換える前に**必ずバックアップ**を取る (`config.yml.bak-<日付>`)
- **設定はホットリロードされる** (`fs.watchFile`)。設定だけの変更ならサービス再起動は不要
- 手元で検証したいときは `scp` で落とし、`js-yaml` で妥当性を確認してから戻す

```bash
node -e 'const y=require("js-yaml"),f=require("fs");
  const j=y.load(f.readFileSync("prod_config.yml","utf8"));
  console.log(Object.keys(j.stream.profiles.recorded));'
```

## 反映できたかの確認

**バージョンだけ見て終わりにしない。** 変更した機能そのものを測る。

```bash
curl -s "https://<本番>/api/version"
curl -s "https://<本番>/api/config" | node -e '...'   # 追加した項目が載っているか
```

配信・再生を変えた場合は `tools/playback-harness/` を本番 URL に向けて実行する
(`debug-playback` skill 参照)。

## 過去に踏んだもの

- **lint を飛ばして push し、本番ビルドが `no-control-regex` で失敗した**。
  ローカルで `npm run compile` と `npm test` しか回していなかった
- **テンプレートを更新しただけで本番に反映されたと思い込んだ**。
  本番の config.yml は独立しており、録画向けプリセットが存在しないままだった
- **孤児プロセスがポートを占有していた**。起動前に既存プロセスを確認する
  (`lsof -nP -iTCP:8888 -sTCP:LISTEN` / Windows は `Get-Process`)
- **本番の設定には他地域由来の古い値が残っていることがある**。
  スキャン結果や API 応答だけで「設定が正しい」と判断しない
- **エンコード中に `Restart-Service` して、古いプロセス群が残り本番が約 6 時間止まった** (2026-09-15)。
  winsw が子プロセス (AmatsukazeEncodeTool) の停止で「アクセスが拒否されました」になり、古いラッパーが孤立。
  新旧が二重に起動したので新しい側を止めたところ、孤立した古いラッパーが約 30 分ごとに EPGStation を再起動し続け、
  毎回 `check db` の直後で止まって 8888 を開かなかった (MySQL にロックは無かった)。
  孤立したラッパーと EPGStation の node をすべて止めて `Start-Service` し直したら正常に起動した。
  対策は上の「サービス」の確認手順。反映後は `/api/version` だけでなく 8888 の PID と Operator ログの起動完了 (`start service pid`) まで見る
