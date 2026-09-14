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
- `m2ts-seek`: 録画ストリーミング (通常は `m2tsll`、`original` / `hls` も指定可) を80%前方・30%後方・90%前方へ順にシーク。各シーク後8秒以内に `currentTime` が進み、`paused=false`、`error=null`、`readyState >= 2`、canvas フレームが黒でなく必要回数変化することと `pageerror=0` を要求。
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
- `offline-records`: 実 TS または自動生成した60秒 MPEG-2 1080i + AAC を録画 HLS 相当の ffmpeg → `Fmp4Packager` → `EPGODL2` レコード経路へ通し、レコード数・継続時間・Node RSS・ローカル HLS の ffprobe 結果を測定。生成物は `/private/tmp` 相当の一時ディレクトリへ残す。
- `original-hevc`: `--input-ts` の HEVC MPEG-TS を `original-hevc` 相当の fMP4 へ remux し、ARIB 字幕専用 reader → `AribId3Extractor` → `Fmp4Packager` の emsg 件数と対応video sampleとの時刻差を測定する。`--without-subtitles` で修正前相当、`--offline` で `OfflineFmp4RecordStream` に保存されたemsgを測定する。
- `offline-app`: `offline.mjs` で保存済みの Chromium 永続プロファイルを `--profile-dir` で指定し、オンライン再生 → 回線断 reload → オフライン再生 → 回線断の新規タブ起動を同じ流れで測定する。`offline.mjs` は保存処理専用として残し、再生・機内モード確認はこちらへ集約する。
- `ui-original-flow`: 録画詳細で「配信」→録画ファイル→配信方式→画質→視聴を操作し、再生進行と80%/30%シークを測定する。`--profile` と遷移後 URL の `profile` が一致することも判定する。
- `watch-history-flow`: `--video-file-id` の履歴行を選び、視聴履歴ダイアログから配信再生する。履歴位置からのレジューム、再生進行、`profile` 一致を判定する。
- `container-switch`: 再生中の DPlayer 画質メニューで M2TS-LL → オリジナル (MPEG-2) → M2TS-LL を切り替え、位置継承と再生進行を測定する。
- `live-original`: ライブ Original を指定時間 (既定60秒)、4秒間隔で測定する。各 currentTime 増分と paused、15秒相当の連続停止を JSON へ出す。
- `offline-hevc`: HEVC 録画を録画詳細のオフライン保存 UI から Original (HEVC・無変換) で保存し、同一コンテキストをオフラインにして `/offline-videos` の再生を測定する。WebKit 前提。

`subtitle` は `--streaming-type original --profile original-mpeg2` (MPEG-2)、`--streaming-type original --profile original-hevc` (HEVC) を指定できる。字幕区間の開始は `--ss SEC` で指定する。保存済みオフライン動画は `--offline --profile-dir PATH --browser webkit --ss SEC` を使う。

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

node tools/playback-harness/run.js offline-records
node tools/playback-harness/run.js offline-records --input-ts /path/to/recorded.ts
node tools/playback-harness/run.js original-hevc --input-ts recorded/hevc_tsreplace.ts --seek-seconds 300
node tools/playback-harness/run.js original-hevc --input-ts recorded/hevc_tsreplace.ts --seek-seconds 300 --without-subtitles
node tools/playback-harness/run.js original-hevc --input-ts recorded/hevc_tsreplace.ts --seek-seconds 300 --offline
EPGSTATION_BASE_URL=http://127.0.0.1:8888 node tools/playback-harness/run.js offline-app --profile-dir /path/to/profile

E2E_NODE_PATH=/private/tmp/claude-501/-Users-ayumu-prog-EPGStation/be903643-1d1e-4bc5-93ec-462a0c4c7ebc/scratchpad/e2e/node_modules
NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js ui-original-flow \
  --recorded-id 16526 --video-file-id 31017 --file-label TS --browser chromium \
  --streaming-type original --profile original-mpeg2 --quality 'オリジナル (MPEG-2・端末で変換)'

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js watch-history-flow \
  --recorded-id 16526 --video-file-id 31017 --browser chromium \
  --profile original-mpeg2 --quality 'オリジナル (MPEG-2・端末で変換)'

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js container-switch \
  --recorded-id 16526 --video-file-id 31017 --browser chromium

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js live-original \
  --channel-id 3241621504 --mode 0 --duration 60 --interval 4 --browser chromium

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js offline-hevc \
  --recorded-id 16525 --video-file-id 31019 --file-label HEVC_tsreplace --browser webkit \
  --profile original-hevc --quality 'オリジナル (HEVC・無変換)'

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js subtitle \
  --video-file-id 31017 --recorded-id 16526 --streaming-type original --mode 0 \
  --profile original-mpeg2 --ss 300 --browser chromium

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js subtitle \
  --video-file-id 31019 --recorded-id 16525 --streaming-type original --mode 0 \
  --profile original-hevc --ss 300 --browser webkit

NODE_PATH="$E2E_NODE_PATH" EPGSTATION_BASE_URL="$BASE" node tools/playback-harness/run.js subtitle \
  --profile-dir /path/to/saved-webkit-profile --offline --ss 300 --browser webkit
```

`watch` の通常録画画面はブラウザのネイティブ再生経路、`m2ts-seek` は録画 m2tsll 経路、`hls-subtitle` は録画 HLS 経路を測定する。`video.play()` を直接呼び、再生領域クリックによる再生・一時停止トグルは使わない。
