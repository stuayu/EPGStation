---
name: debug-playback
description: EPGStation のライブ・録画の再生不具合 (再生が始まらない・止まる・シークで固まる・字幕や音声が出ない・画質切替がおかしい) を調べて直すときに使う。原因が配信コマンド・エンコーダ・パッケージャ・プレイヤーのどこにあるかを実測で切り分ける手順。
---

# 再生不具合の調べ方

この領域は**コードを読んだだけでは原因を外す**。実際にそうなった例が多いので、必ず実測で切り分ける。

## 最初にやること: どの層で壊れているかを決める

上から順に、**壊れていない層を確定させながら**下りる。

| # | 層 | 測り方 | 壊れていない証拠 |
| --- | --- | --- | --- |
| 1 | エンコーダ | `curl` でストリーム API を直接叩き、`ffprobe` でフレーム数を数える | フレームが実時間相当で増える |
| 2 | パッケージャ | セグメントのバイト列を見る (`grep -a emsg` など) | 期待する box が入っている |
| 3 | 配信 (HTTP) | 応答コードと受信バイト数 | 200 で、実時間ぶんのデータが届く |
| 4 | プレイヤー | ブラウザで `video.currentTime` / `buffered` / `readyState` を見る | currentTime が進む |

**ブラウザから始めない。** 1 と 2 は `curl` + `ffprobe` だけで確定でき、そのほうが速く確実。

```bash
# 例: 録画 m2tsll が本当に配信できているか (フレーム数を数える)
curl -s --max-time 25 "http://localhost:8888/api/streams/recorded/<videoFileId>/m2tsll?mode=0&ss=300&audioTrack=all" -o /tmp/s.ts
ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 /tmp/s.ts
ffprobe -v error -show_entries stream=index,codec_type,codec_name -of csv=p=0 /tmp/s.ts
```

## 既製のシナリオを使う

`tools/playback-harness/` に実機計測シナリオがある。**書き捨てのスクリプトを新規に作る前にここを見る。**

```bash
node tools/playback-harness/run.js --help
node tools/playback-harness/run.js watch --base-url URL --video-file-id ID --recorded-id ID --duration 300
```

新しい測り方が必要になったら、**シナリオとして追加する** (次に同じ症状を追う人が再利用できる)。

## 実際に踏んだ地雷

いずれも**実測して初めて分かった**もの。同じ罠を踏まないこと。

### 症状から原因を外しやすいもの

- **「特定の再生位置だけ再生が始まらない」→ エンコーダが 0.07 倍速になっていた**
  `-map "0:i:0x1ffe?"` で ID3 を入力側へ map すると、字幕が疎な区間で mpegts muxer が
  インターリーブ待ちになる。字幕が多い区間では起きないため**位置依存**に見える。
  切り分け: `ffmpeg` の `speed=` を見る。`frame=` が止まって `time=` だけ進むのが特徴
- **「シークすると固まる」→ 同じシークで 2 本のストリームを要求していた**
  レジュームと手動シークが競合し、サーバが同じ streamId を stop → start で置き換え、
  プレイヤーが掴んでいた 1 本目が切られていた。切り分け: `access.log` の要求を数える
- **「字幕が出ない」→ 文字スーパーを字幕 ES と取り違えていた**
  ARIB 字幕は `component_tag=0x30`〜`0x37`。`0x38` は文字スーパー。
  切り分け: PMT を解析して `stream_type` と `component_tag` を実際に見る
- **「副音声に切り替えられない」→ ffmpeg の probe が小さく 2 本目の音声 ES を見つけていなかった**
  放送の副音声 ES は番組の途中から現れることがある (実測: 主音声の 20,183,492 byte あと)。
  パイプ入力の ffmpeg は**probe が終わった時点の PMT で map を確定する**ため、
  `-probesize 5000000` では 2 本目が「入力に存在しない」扱いになり、
  `-map "0:a:1?"` は optional なので**黙って無視されて主音声だけが配信される**
  (エラーも警告も出ない)。切り分けは次の 3 点:
  1. `ps ax -o args | grep [f]fmpeg` で**実際に起動している cmd** を見る (`-map 0:a:1?` が入っているか)
  2. `logs/Service/stream.log` の `Stream #0:N -> #0:M (aac` を数える (出力音声の本数)
  3. in-memory HLS なら `grep "role=" logs/Service/stream.log`。
     `role=single` は音声 1 本、`role=video` / `audio0` / `audio1` なら複数レンディション
  同じ TS を probesize だけ変えてパイプへ流せば一発で切り分く:
  `cat 素材.ts | ffmpeg -probesize <値> -i pipe:0 -t 3 -map 0:v:0 -map "0:a:0?" -map "0:a:1?" ... -f mp4 out.mp4`
- **「エンコードが遅い」→ プログレッシブ素材に `yadif` をかけていた**
  `field_order=unknown` でも 59.94fps の HEVC は tsreplace 出力のプログレッシブ。
  外すと 3.59 倍速 → 5.28 倍速 (実測)

### 計測そのものを間違えた例

- **サーバを再起動したのに古いコードで計測していた**: `pkill -f "node dist/index.js"` は
  親 (Operator) しか殺さない。子の `ServiceExecutor.js` / `EPGUpdateExecutor.js` が生き残って
  port 8888 を握り続けるため、新しく起動した方は何も配信せず、**修正前のコードの結果を測ってしまう**
  (デバッグログを仕込んでも出ないので「コードが効いていない」と誤診する)。
  `ps ax -o pid,lstart,args | grep "[E]PGStation/dist"` で起動時刻を確認し、
  `pkill -9 -f "EPGStation/dist"` まで落としてから起動し直す

- **`currentTime` が進むことは「映像が出ている」証拠にならない**。真っ黒でも進む。
  利用者から「映像が流れていない」と報告された状態を PASS と報告した。
  **video を canvas へ描いてピクセルを見る** (輝度の最大値と、サンプル間の変化)
- **直 URL だけで検証しない**。UI から遷移したときの URL が違うことがある。
  実際に配信選択ダイアログが `streamingType=m2ts-ll` (API は `m2tsll`) を生成しており、
  直 URL しか叩いていなかったため 404 を見逃した。**利用者と同じ操作経路を通る**

- **`.dplayer-video-wrap` をクリックして再生を開始しない**。再生/一時停止のトグルに当たり、
  「再生できていない」のを「再生が止まる不具合」と誤認した。**`video.play()` を直接呼ぶ**
- **`grep` の対象に自分のコマンド行が混ざる**。`ps | grep h264_qsv` で、実際には使っていない
  エンコーダを「使っている」と誤読した。`pgrep -f "^/path/to/ffmpeg"` で厳密に絞る
- **MSE を隠して MMS 経路を再現するときは `delete window.MediaSource`**。
  getter で `undefined` を返すと `'MediaSource' in self` が true のままになり、
  ライブラリが MSE 経路を選んで別のエラーを出す (実機とは無関係の人工物)
- **機械の負荷を確認する**。他プロセスで load が上がっていると配信が実時間を割り、
  製品の不具合に見える。`uptime` を併記する
- **`video.currentTime` だけで映像再生を合格にしない**。真っ黒画面でも時刻は進むため、今回の再生ハーネスは
  canvas へ描画したフレームの輝度とサンプル間変化を確認する。`videoWidth === 0` や描画取得失敗も不合格として扱う

## 触る前に読む

- `doc/streaming-refresh.md` — 配信経路・エンコード・プレイヤー UI
- `doc/PROJECT_OVERVIEW.md` の「ストリーミング・データ放送」節 — 踏むと壊れる箇所

## 直したあと

**単体テストが通ったことは「症状が直った」根拠にならない。** 必ず上の 1〜4 のどれかで
修正前後の数値を出す。出せない場合は「未検証」と報告する。
