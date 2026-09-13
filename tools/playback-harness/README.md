# 実機計測ハーネス

実サーバと実録画ファイルを使う手動・実機計測用ツール。`npm test`、ITA、CIへは含めない。

## 前提

- EPGStation が稼働中であること。サーバの起動・停止はハーネスから行わない。
- 再生対象の `videoFileId`、`recordedId`、必要なら `mode` と録画先頭時刻を指定すること。
- Playwright シナリオは `playwright-core` と対象ブラウザが必要。未導入時は次で一時導入する。

```sh
npm install --no-save playwright-core
```

`playwright-core` は `package.json` に追加しない。実サーバ・実ブラウザを要求する手動計測であり、通常の依存へ入れると CI の依存解決と実行環境を不要に広げるため。

## 入口

```sh
EPGSTATION_BASE_URL=http://<server-host>:8888 \
node tools/playback-harness/run.js --help
```

`--base-url` は環境変数より優先。`--hash` で既存の hash route を直接渡せる。`--video-file-id` と `--recorded-id` を渡すと通常録画画面を自動生成する。HLS / m2tsll は `--streaming-type` と `--mode` を追加する。

合否は終了コードで返す。`0` は PASS、`1` はしきい値不合格、`2` は引数・依存・外部コマンド不足。

`video.currentTime` が進むことは映像が出ている証拠にならない。ハーネスは各採取時に `video` 要素を
160x90 の canvas へ描画し、全画素の輝度平均・最大値・標準偏差を測定する。`videoWidth === 0`、
`drawImage` / `getImageData` の失敗、真っ黒フレーム、画面変化不足は不合格とする。

## シナリオと合否条件

- `watch`: 指定時間の `currentTime`、`buffered`、`readyState`、canvas フレーム輝度を採取。既定は停止回数0、最長停止0秒、再生進行1秒以上、真っ黒フレーム比率0、画面変化1回以上。結果に `blackFrameCount`、`blackFrameRatio`、`frameChangeCount`、`frameFailureCount` を含む。`--max-stops`、`--max-stall-seconds`、`--min-progress-seconds`、`--max-black-ratio`、`--min-frame-changes`、`--black-luma-max`、`--frame-change-threshold` で上書き。静止画番組は `--min-frame-changes 0`。
- `jikkyo-seek`: 再生中35%、一時停止中65%、再開後、画質切替後、巻き戻し20%を測定。実況の突き合わせ標本を1件以上集め、最大絶対ずれを既定2秒以内。`--video-start-at` は録画先頭の Unix ms。
- `m2ts-seek`: 録画 m2tsll を前方80%・後方20%へシーク。各シーク後に `readyState >= 2` かつ `buffered.end > currentTime`、canvas フレームが黒でなく必要回数変化することを要求。
- `m2ts-deep`: 35%シーク後の `buffered`、`readyState`、Resource Timing 受信バイトを測定。既定1KiB以上の受信、バッファ・再生可能状態を要求。
- `duplicate-player`: 画質切替中の `.dplayer`、`video`、`.dplayer-ptime`、`.dplayer-played` を監視。各最大数が1、画質候補が存在すれば合格。
- `ptime`: シーク後・画質切替後の `.dplayer-ptime` を採取。全標本が時刻形式として解析可能なら合格。
- `hls-subtitle`: HLS の m4s/mp4 応答を採取。既定で3セグメント以上、全セグメントに `emsg` があれば合格。`--min-emsg-ratio` で比率を緩和可能。
- `emsg`: ブラウザ不要。curl で録画 HLS を開始し、プレイリストのセグメントを取得、ffprobe で読めることと `emsg` 比率を確認。既定で3セグメント以上・全セグメントに `emsg`。
- `subtitle`: canvas の不透明ピクセルを測定。既定1ピクセル以上を字幕描画ありと判定。字幕が実際に存在する録画を使うこと。
- `quality-switch`: 画質候補を切替え、`currentTime` が2回連続で進み、切替後の canvas フレームが黒でなく必要回数変化するまでを測定。既定40秒以内。
- `recording-stress`: `--stress long|seeks|pause|tail` と `--parallel N`。長時間、シーク連打、一時停止放置・再開、終端近傍を複数ページで測定し、既定しきい値で停止なしを要求。
- `ipad-audio`: WebKit の iPad Mini 相当で音声・画質候補を確認。既定で各1項目以上。
- `mms`: WebKit の `MediaSource` を隠し、`ManagedMediaSource` 経路で再生進行を確認。既定1秒以上、`readyState >= 2`。

## 実行例

```sh
BASE='http://<server-host>:8888'
VF='<video-file-id>'
RID='<recorded-id>'

EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js watch \
  --video-file-id "$VF" --recorded-id "$RID" --duration 300 \
  --browser chromium --max-stops 0 --max-black-ratio 0 --min-frame-changes 1

EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js m2ts-seek \
  --video-file-id "$VF" --recorded-id "$RID" --streaming-type m2tsll --mode 0 \
  --browser chromium

EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js hls-subtitle \
  --video-file-id "$VF" --recorded-id "$RID" --streaming-type hls --mode 0 \
  --browser webkit --device 'iPad Mini' --duration 64

EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js emsg \
  --video-file-id "$VF" --mode 0 --seek-seconds 300
```

`watch` の通常録画画面はブラウザのネイティブ再生経路、`m2ts-seek` は録画 m2tsll 経路、`hls-subtitle` は録画 HLS 経路を測定する。`video.play()` を直接呼び、再生領域クリックによる再生・一時停止トグルは使わない。
