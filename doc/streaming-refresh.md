# ストリーミング刊新 (低遅延・iOS/Android 対応・iOS 26 対策)

本ドキュメントは 2026-07 のストリーミング周りの改修内容と運用方法をまとめたもの。

## ハードウェアエンコーダの自動判定

`hardwareEncoder` は `auto` (既定) / `qsv` / `nvenc` / `vce` / `videotoolbox` /
`software` を選ぶ。Service 起動時に `HardwareEncoderDetector` が一度だけ
QSVEncC / NVEncC / VCEEncC の `--check-hw` (終了コードと出力) と、設定された ffmpeg の
`-hide_banner -encoders` を調べる。結果は singleton にキャッシュし、配信開始ごとの外部プロセス起動は行わない。

`cmd` を省略した配信プロファイルは、選択結果に応じて ffmpeg の `h264_qsv` /
`hevc_qsv`、`h264_nvenc` / `hevc_nvenc`、`h264_amf` / `hevc_amf`、
`h264_videotoolbox` / `hevc_videotoolbox`、または libx264 / libx265 を使う。
rigaya の検出に成功した場合は QSVEncC / NVEncC / VCEEncC と ffmpeg remux のパイプラインを使う。
録画ファイル入力の rigaya 経路には `--avsync forcecfr --fps 30000/1001` を付ける。
HEVC の MP4/fMP4 出力には `-tag:v hvc1` を付ける。手書き `cmd` は一切変更しない。

検出失敗・タイムアウト・手動指定の利用不可は software へフォールバックし、info/warn ログへ残す。
`GET /api/config` の `hardwareEncoder` と設定フォームの選択肢は同じ検出結果を使う。

## 変更概要

### 1. mpegts.js 1.7.3 → 1.8.0 (ManagedMediaSource 対応)

- iOS / iPadOS Safari 17.1+ の **ManagedMediaSource (MMS)** に対応した mpegts.js 1.8.0 へ更新。
- これにより **iPhone / iPad の Safari でも M2TS-LL (低遅延) のライブ・録画視聴が可能**になる (KonomiTV と同じ方式)。
- MMS は `video.disableRemotePlayback` が設定されていないと動作しないため、`DPlayerUtil.setupGlobals()` で `window.mpegts.createPlayer` をラップし、アタッチ前に `disableRemotePlayback` / `playsinline` を自動設定する。
- **適用には `cd client && npm i` が必要** (サンドボックス環境ではレジストリに到達できないため未適用。コードは 1.7.3 のままでも動作する後方互換設計)。

### 2. iOS 26 以降の既知不具合への対処 (`StreamSupportUtil`)

`client/src/util/StreamSupportUtil.ts` の `checkM2TSLLSupport()` に判定を集約:

| 環境                                  | M2TS-LL        | 備考                                                      |
| ------------------------------------- | -------------- | --------------------------------------------------------- |
| Chrome / Edge / Firefox               | ◯              | 従来通り MSE                                              |
| iOS / iPadOS Safari 17.1+ (タブ)      | ◯              | MMS 経由 (要 mpegts.js 1.8.0)                             |
| iOS / iPadOS 26+ のホーム画面 Web App | × → HLS へ誘導 | WebKit の不具合で再生開始不能 (KonomiTV でも 26.1 で報告) |
| macOS Safari 26+                      | ◯              | mpegts.js を tsukumijima フォークへ固定して解消 (WebKit 26 で 6 分連続再生を実測) |
| 古い iOS (17.1 未満)                  | × → HLS へ誘導 | MSE/MMS 非対応                                            |

- 判定結果は `ServerConfigModel` (配信形式の出し分け)、`OnAirSelectStream` (視聴ダイアログ)、`LiveMpegTsVideo` (プレイヤー)、`Settings` で共通利用。
- 非対応時は理由付きのエラーメッセージを表示し、ネイティブ HLS へ誘導する。


### 3. プレイヤー上からの解像度動的切替 (M2TS-LL)

- DPlayer の設定メニューに **画質 (quality) リスト**を表示し、再生を止めずに `config.yml` の `stream.live.ts.m2tsll` の各設定 (1080p / 720p / 480p など) を切り替え可能。
- サーバー側は接続単位でエンコードプロセスを起動する。M2TS-LL の画質切替は別の video 要素を使うため DPlayer の旧 mpegts.js を新側の `canplay` まで保持し、再生開始後に旧側を停止する。一方、録画のレジューム・シーク (`switchVideo()`) は同じ video 要素を再利用するため、DPlayer が新 URL を `video.src` へ設定する前に旧側を破棄する。**URL が同じ同値シークも再生位置へ戻る操作なので、同じ `reset` 経路で MediaSource / SourceBuffer / mpegts.js を作り直す**。旧 video 専用の ARIB renderer も新しい時間軸へ持ち越さない。同じ要素で旧側を遅延 detach すると、新側の MediaSource まで外れて `SourceBuffer` 参照エラーになる。保持する旧側は常時1本以下に制限し、連続切替・コンポーネント破棄でも cleanup を完了させる。ライブ HLS は新ストリームの `canplay` まで旧ストリームを残す。新側の準備に失敗した場合は新側だけを回収する。
- ライブ HLS / 録画ストリーミングの切替は後述の「全配信方式での画質切替」で対応済み。
- DPlayer の quality 配列を playback-options で差し替えるときは、内部 `blob:` URL や空の `video.src` を配信 URL として引き継がず、`options.video.url` → 現在 quality → `currentSrc` / `src` の順で有効な URL を選ぶ。画質切替後の URL は `options.video.url` と quality の両方へ同期する。mpegts.js の生成入口でも空・内部 `blob:` URL を検出したら初期化せずエラーにする。

### 3a. 録画 M2TS-LL

- `GET /api/streams/recorded/{videoFileId}/m2tsll?ss=<秒>&mode=<番号>&profile=<id>&audioTrack=<指定子>` を追加した。`mode` または `profile` は既存の録画 HLS / MP4 と同じ規則で、`ss` は小数秒を受け付けるが、クライアント・API・ストリーム生成直前で0以上の整数秒へ切り捨てる。
- 録画 TS は `RecordedStreamBaseModel` がファイル (録画中は `TailStream`) をエンコーダ stdin へ流し、stdout を `video/mp2t` として HTTP へ直結する。encoded は `-ss %SS% -i %INPUT%` のファイル入力で、いずれも中間ファイルを作らない。
- クライアントは録画詳細に `M2TS-LL` を追加し、`StreamSupportUtil.checkM2TSLLSupport()` が非対応と判定した環境では選択肢から除外して HLS へ誘導する。再生は `type: 'mpegts'`、VirtualTimeline、チャプター、ARIB 字幕、実況コメント、音声切替を既存録画再生と共用する。
- `audioTrack=all` は tsreadex 正規化済みプロファイルで主音声・副音声を同時配信し、mpegts.js の音声切替 API で再接続せず切り替える。非正規化プロファイルは `AUDIOSELECTMAP` で単一音声を選ぶ。
- 録画 TS の m2tsll の ARIB 字幕は、tsreadex の有無によらず入力側でなく stdout 側へ ID3 timed metadata を挿入する。字幕判定は `component_tag=0x30〜0x37` / `0x87` または `stream_type=0x06` + `subtitling_descriptor (0x59)`、data_group は `0x00〜0x08` / `0x20〜0x28` を受ける。PTS の無い PES は時刻を推測せず破棄する。encoded は字幕対象外。
- 録画のファイル入力は `-readrate 1.5 -readrate_initial_burst 45 -readrate_catchup 2` を `-i` より前へ置く。初期 45 秒 (4 Mbps 換算で約 22.5 MB) を先読みし、その後は実時間の 1.5 倍を上限に供給する。`readrate_catchup` は入力が指定速度に遅れたときだけ一時的に 2 倍まで使う。対象は M2TS-LL / MP4 / WebM。ライブの `-re` は変更しない。録画 HLS は既存のセグメント単位の先行抑制を使う。今回、readrate 引き上げは供給が律速でないことが判明したため前値へ戻した。
- Chromium で同一素材の録画 M2TS-LL (`videoFileId=31024`) を5分連続再生した際、60〜120秒で前方バッファが枯渇する症状は観測された。ただしこれは供給不足が原因ではない。`createReadStream` → `ID3MetadataTransform` → `ffmpeg.stdin` と同じ供給経路は `speed=4.65x` で、律速はエンコード側だった。

| 実時間 | ct | buf | rs |
| ---: | ---: | ---: | ---: |
| 0s | 0.14 | 12.76 | 4 |
| 30s | 30.22 | 42.77 | 4 |
| 60s | 60.28 | 61.69 | 4 |
| 90s | 75.89 | 81.75 | 4 |
| 120s | 98.17 | 98.24 | 2 |
| 150s | 117.63 | 122.69 | 4 |
| 180s | 138.73 | 143.15 | 4 |
| 210s | 168.79 | 189.50 | 4 |
| 240s | 198.91 | 244.80 | 4 |
| 270s | 229.00 | 287.48 | 4 |
| 300s | 259.09 | 330.81 | 4 |

この症状を再現した素材のエンコード設定別実測は次のとおり。素材は ffprobe で `codec_name=hevc`、`1440x1080`、`yuv420p10le`、`r_frame_rate=60000/1001`、`avg_frame_rate=60000/1001`、`field_order=unknown` で、プログレッシブだった。

| エンコード設定 | fps | speed |
| --- | ---: | ---: |
| 現状 (`-vf yadif,scale=-2:720`、出力 59.94fps) | 80 | 3.59x |
| `yadif` なし | 117 | 5.28x |
| `yadif` なし + `-r 30000/1001` | 157 | 5.24x |
| `h264_videotoolbox` (HW、今回は採用しない) | 154 | 6.95x |

`yadif` を外すだけで 47% 改善し、供給経路の `speed=4.65x` を下回っていた律速が解消する。プリセット生成時点では素材が未確定なので、`StreamProfileManageModel.buildCmd()` は `-vf %DEINTERLACE%,scale=...` の形でプレースホルダを保持する。配信開始時に `RecordedStreamBaseModel` / `LiveStreamBaseModel` が `SourceAnalyzer` の結果を使って置換する。ffprobe の `field_order` と fps から progressive と判定できる素材は `yadif` を入れず、`tt/tb/bb/bt` または `progressive` 以外の判定不能時は放送波そのままの MPEG-2 1080i を守るため `yadif` 有りに倒す。ライブも実測で progressive と判定できる場合だけ無しにする。`video_file` / `video_file_ts_info` に fps / field_order は無いため DB fallback は yadif 有りを維持し、欠落した解析結果はキャッシュしない。実行時は `deinterlace: yadif=... (source: ..., codec: ..., field_order: ..., fps: ...)` の info ログで枝と判定値を確認できる。プレースホルダを持たない手書き cmd は利用者の指定を変更しない。
- mpegts.js の録画 M2TS-LL は `lazyLoad: false` とする。`lazyLoad` は前方バッファが上限を超えた時に transmuxer を停止し、その HTTP 接続を切る。録画 m2tsll の API はレスポンス `close` をストリーム停止として扱い、Range/再接続で同じ配信を継続する契約ではないため、lazyLoad の再接続で再生が数分ごとに停止する。クライアント側は `autoCleanupSourceBuffer: true`、`autoCleanupMaxBackwardDuration: 30`、`autoCleanupMinBackwardDuration: 15` で再生済み領域だけを解放する。`autoCleanupSourceBuffer` は前方バッファを削除しないため、録画 HLS の `getAheadSegmentNum()` 抑制とは別の役割とする。供給経路は `speed=4.65x` で、前方バッファ枯渇の主因はプログレッシブ素材へ不要な `yadif` を掛けたエンコード遅延だった。ライブ M2TS-LL (`LiveMpegTsVideo.vue`) は lazyLoad とペーシングを変更しない。
- mpegts.js / DPlayer には初回再生に必要な前方バッファ秒数を指定する設定がない。そのため録画 M2TS-LL は DPlayer の `play()` をクライアント側でゲートし、前方バッファが8秒以上 (短い録画は終端まで) たまってから自動再生・手動再生を開始する。開始が数秒遅れても、実時間付近のエンコードで開始直後にバッファを使い切る事態を避ける。
- 録画 M2TS-LL の再生中に停滞が起き、Resource Timing または mpegts.js の `statisticsInfo.speed` で現在画質を維持できる帯域が観測できた場合は、回線不足ではなく配信側エンコードの遅延候補とみなして `recommended.fallbackChain` の低負荷側へ降格する。帯域サンプルが不足する場合は従来どおり1段ずつ降格し、fallback 後25秒のクールダウンと chain の末尾で下限を設ける。手動画質は変更しない。
- 原因の実測: WebKit 26 で30分録画を5分計測すると停止4回、最長40秒。停止時にサーバーのストリーム数が0となり、約15秒後に再作成された。目標は WebKit / Chromium の各5分計測で停止0回、サーバーのストリームが途中停止しない、前方バッファ15秒以上。
- 録画 M2TS-LL の生成 cmd は `mpegts` を `pipe:1` へ出力し、`-flush_packets` は指定しない。Node の stdout/HTTP backpressure に任せる既存経路で、`-flush_packets 1` のパケット単位 flush は書き出しをさらに細切れにして WebKit の `readyState` 揺れを悪化させうるため追加しない。今回の主因はプログレッシブ素材への不要な `yadif` によるエンコード遅延であり、出力 flush 設定は変更しない。
- ffmpeg 9 未満の自動フォールバックは実装しない。`-readrate_initial_burst` / `-readrate_catchup` の互換性を安全に判定できない手書き cmd をサーバー側で改変せず、古い ffmpeg を使う場合は設定 cmd から readrate 系を外す (または `-re` へ置換する)。

### 4. MSE / hls.js チューニング

mpegts.js (`LiveMpegTsVideo`):

```js
enableWorker: true,
liveBufferLatencyChasing: true,   // 遅延自動追いかけ
 liveBufferLatencyMinRemain: 0.5, // 最小残留バッファ (旧: 1.0)
liveBufferLatencyMaxLatency: 2.0,
autoCleanupSourceBuffer: true,    // 長時間視聴のメモリ増加対策
autoCleanupMaxBackwardDuration: 30,
autoCleanupMinBackwardDuration: 15,
enableStashBuffer: true,           // TS/PES のチャンク境界を吸収
stashInitialSize: 64 * 1024,       // 約0.13秒分 (4Mbps換算)
```

stash は無効にするとチャンク境界で音声・字幕が不安定になるため有効のままにする。64KiB は mpegts.js の既定値と同じで、低遅延と安定性のバランスを維持しつつ明示固定する値。副音声・ARIB 字幕は mpegts.js の同じ入力経路を通るため、この変更で別経路へ切り替えない。stash 設定そのものによる起動短縮は見込まず、将来の既定値変更による遅延・不安定化を防ぐ。

hls.js (`LiveHLSVideo`、Safari 以外):

```js
liveSyncDurationCount: 2,        // ライブエッジ同期距離を短縮
liveMaxLatencyDurationCount: 6,
backBufferLength: 30,            // メモリ増加対策
```

- Safari / iOS では自動再生ポリシーによる停止を避けるため、M2TS-LL でも自動再生を無効化し再生ボタン操作で開始するように変更。

### ライブ受信の共有

ライブ配信は `LiveStreamSourceManageModel` が `channelId` 単位で Mirakurun の service stream を共有する。
最初の配信だけが Mirakurun へ接続し、後続の画質・音声切替は同じ受信を `PassThrough` で分岐するため、
受信確立 (`getServiceStream`) の待ち時間を繰り返さない。分岐後の `BroadcastTimeExtractor`、
`BitCollectTransform`、`EitPresentCollectTransform`、ARIB 字幕変換、エンコード処理は配信ごとに独立するため、
EIT[p/f]・実況時刻・字幕が配信間で共有状態にならない。無変換配信も同じ枝をそのまま返す。

各枝は lease の `release()` を1回だけ実行でき、参照が0になった時点で枝と Mirakurun 上流を閉じる。
上流の `close` / `end` / `error` でも共有表から除去するため、切替失敗や受信異常で残留しない。
参加時は以後の PAT/PMT 到着を待つ。放送波の PAT/PMT 周期が短いため、現状はリングバッファを持たず、
受信データを無制限に保持しない。録画 (`RecorderModel`) と EPG 更新の受信はこの共有対象外。

サーバーログの `get mirakurun service stream` は新規受信、`reuse mirakurun service stream` は枝追加、
`release ... references: 0` と `close shared mirakurun service stream` は上流解放を示す。

### 再生停滞時の自動画質 fallback

`VideoContainer` は「おまかせ」選択時だけ、全配信方式で video 要素の実測値を共通監視する。直近 30 秒の低バッファ `waiting` 3 回、または再生中の `currentTime` 無進行 5 秒 + バッファ残量 1 秒以下を停滞と判定する。Resource Timing API のセグメント/パート取得実績、または mpegts.js の連続配信速度が2件以上あれば、取得時間とサイズから実効帯域を推定し、API が返す `PlaybackProfile.videoBitrate` のうち安全率75%に収まる低負荷段へ直接降格する。停滞中でも帯域が現在画質に十分なら、回線ではなく配信側エンコード遅延の候補として扱う。Safari の一部やクロスオリジンなどで帯域を観測できない場合は推定せず、1段ずつの fallback に戻す。起動・シーク・画質切替・タブ復帰の猶予と fallback 後 25 秒のクールダウンを持つため、一時的な decoder 待ちやバックグラウンド停止で誤降下しない。明示画質は変更しない。判定本体は `src/util/PlaybackStallDetector.ts` の純粋関数で、UT から直接検証する。

録画済み HLS の範囲外シークは、サーバーの ready 判定を 1 セグメントへ緩和し、クライアントの有効化確認を初回即時 + 200ms 間隔で行う。ライブ HLS の ready 判定はライブエッジ追従のため 2 セグメントのまま。

### Safari のライブ HLS は「ネイティブ再生 + aribb24 の in-band metadata 自動検出」

Safari では hls.js / MSE を経由せず標準 video 要素へ m3u8 を直接渡す (ネイティブ HLS) 方針だが、
**DPlayer に `type: 'normal'` を渡してはいけない**。DPlayer の `initMSE()` の `switch` には
`case 'normal'` も `default` も無く、ARIB 字幕 (aribb24.js) の CanvasRenderer を生成するのは
`case 'hls'` / `case 'mpegts'` の中だけなので、レンダラが 1 つも作られず**字幕が一切表示されない**。

そのため `LiveHLSVideo` は Safari でも `type: 'hls'` を渡し、代わりに
`DPlayerUtil.setupGlobals()` が **Safari のみ `window.Hls.isSupported()` が `false` を返すラッパー**を
`window.Hls` に設定する。DPlayer は `case 'hls'` の中でさらに

1. `window.Hls.isSupported()` が true → hls.js (MSE) 経路
2. false かつ `canPlayType('application/x-mpegURL')` → **ネイティブ HLS + `enableAutoInBandMetadataTextTrackDetection = true` で CanvasRenderer を attach**

と分岐するため、2 を選ばせることで「再生方式は `'normal'` と同じ (video へ m3u8 直渡し) ままで字幕だけ有効」にできる。

WebKit は fMP4 の `emsg` を metadata text track (`inBandMetadataTrackDispatchType = com.apple.streaming`) として
通知し、cue は `type = org.id3` / `info = aribb24.js` (PRIV フレームの owner) を持つ。
aribb24.js の自動検出がこれを拾うため、in-memory HLS の字幕が Safari でも表示される
(WebKit 26 / playwright webkit で実機確認済み)。

## 画質選択 UI の入口 (2026-09)

### DPlayer 操作バーへの視聴操作集約

- キャプチャは SNS 投稿パネル内に重複ボタンを置かず、DPlayer 標準のカメラボタンを使う。SNS 投稿パネルがマウントされている場合はキャプチャ要求を同期的に受け取り、画像をブラウザ内の添付候補へ保存して標準の即時ダウンロードを止める。SNS パネルが無い場合は DPlayer 従来どおり画像をダウンロードする。
- データ放送の表示・非表示は上部バーの 3 点メニューではなく、DPlayer 右側操作バーのテレビボタンで切り替える。機能フラグが無効ならボタンを作らず、ON/OFF は従来どおり `ISettingStorageModel.isEnableDataBroadcasting` へ保存する。BML の Manager 所有・`markRaw()`・リモコン表示経路は変更しない。

画質を選ぶ場所は 2 つだけで、それぞれ役割が違う。**入口を増やさない**。

1. **配信選択ダイアログ** (`OnAirSelectStream` / `RecordedDetailSelectStreamDialog`) — 再生を始める前の選択。
   「画質: <名前>」ボタンで `PlaybackQualityList` を**ダイアログの中にインライン展開**する。
   **別のダイアログ / bottom sheet を重ねてはいけない** (放映中からチャンネルを選んだときにモーダルが
   2 枚重なる不具合になっていた)。設定「再生前に画質を選ぶ」が ON のときだけ最初から展開して開く。
2. **DPlayer の設定メニュー** (歯車) — 再生中の切替。`BaseVideo.setPlaybackProfiles()` が
   `playback-options` の profile 一覧を DPlayer の quality へ流し込み、`setupQualitySwitch()` が
   切替直前に url を解決する。**プレイヤーの上に独自の設定アイコンを重ねない** (歯車が 2 つ並ぶ)。

- 画質からサーバの `mode` を引くときは **`PlaybackProfile.modes[<container>]`** を使う。
  プロファイル配列の添字を `mode` に流用すると、絞り込み・並び替えが入った瞬間に別の設定で再生される。
- 配信方式 (M2TS-LL / HLS / MP4 / WebM) を切り替えたら、その container で `playback-options` を取り直す。
- DPlayer 側で画質が切り替わると `qualitySwitched` が親 (`VideoContainer`) へ飛ぶ。
  親はこれを受けて自動画質の fallback を止める (ユーザーの明示的な選択を上書きしないため)。
  **親自身が起こした切替 (自動 fallback) では飛ばさない** — 飛ばすと親が「ユーザーが選んだ」と誤認し、
  2 回目以降の fallback が止まる。
- **DPlayer は生成時に一度だけ設定メニューの DOM を作る**。`options.video.quality` を後から差し替えても
  画面の一覧は古いままで、`switchQuality()` が選択状態を書き換える対象も**生成時に集めた
  `template.qualityItem`** に固定されている。playback-options は録画ファイルの解析を伴い
  応答まで数十秒かかることがありプレイヤー生成に間に合わないため、
  `BaseVideo.refreshQualityMenu()` が項目を作り直して `template.qualityItem` を繋ぎ直し、
  `markCurrentQuality()` が選択中の表示を自前で更新する。
  **チェックアイコンの SVG は既存項目から流用する** (空の `.dplayer-toggle` にするとチェックが消える)。
- **画質一覧には `modes[<container>]` を持つプロファイルだけを出す**。持たないもの (config に対応する
  設定が無い Built-in カタログ由来のプロファイル) は選んでも `mode` が決まらず、選択が黙って無視される。
- **選択肢の取得はレースを潰す**。配信方式を続けて切り替えると古い応答が後から解決して新しい選択を
  上書きするため、ダイアログと `PlaybackOptionsState` (singleton) の両方に取得世代を持たせている。
- **表示名・一言説明・バッジは `PlaybackLabelUtil.getPlaybackLabel()` の 1 か所で決める** (詳細は
  「Phase 8/9 クライアント画質 UI」参照)。DPlayer の設定メニュー (`BaseVideo.setPlaybackProfiles()`) も
  同じ関数で名前を作るため、配信選択ダイアログと表記が食い違わない。
- **配信方式セレクタを手で変えたら選択中の画質表示も追随させる**。`dialogState.selectedStreamConfig` /
  `selectedStreamMode` を `@Watch` し、その mode に一致するプロファイルがあれば `selectPreset()` で
  合わせる (逆方向の画質選択は mode を書き戻すだけなので watch が発火しても実質変化がなく無限ループしない)。

### 端末の設定画面 (設定 > 再生) の既定値

| 設定項目 | クエリ | 効き方 |
| --- | --- | --- |
| 既定の画質 | `profile` | 指定があればそのプリセットを選ぶ (最優先) |
| 映像補正 | `preferCorrection` | 自動選択のスコアへ加減点 |
| HDR | `preferHdr` | 自動選択のスコアへ加減点 (素材が HDR のときだけ) |
| モバイル回線では画質を下げる | `saveData` | 端末の回線種別が `cellular` / `slow` のときだけ加減点 |

`PlaybackPolicyResolver.preferenceScore()` が計算する。**候補の絞り込みではなく加減点**にしてあるのは、
設定に合う候補が 1 つも無い環境でも再生を止めないため。画質一覧で明示的に選んだプリセットは
端末設定より優先される。**fallback 候補 (`fallbackScore()`) の並びも同じ向きにする** —
常に高画質優先のままだと、通信量を抑える設定で選んだ低画質から再生に失敗したときに高画質へ戻ってしまう。

## 運用: ディスクにデータを残さない HLS 配信 (tmpfs)

M2TS-LL はパイプ配信のためディスク書き込みなし。HLS はセグメントを `streamFilePath` に書き出すため、tmpfs を指定すると完全メモリ配信になる:

```yaml
# config.yml
streamFilePath: '/dev/shm/epgstation-streamfiles'
```

Docker の場合:

```bash
docker run --tmpfs /app/data/streamfiles:size=256m ...
# または compose で tmpfs マウントを指定し streamFilePath を合わせる
```

HLS の遅延を詰める場合はエンコードコマンドに GOP 固定を追加する:

```
-g 60 -keyint_min 60 -sc_threshold 0
```

## 既知の制限

- 配信形式 (M2TS-LL ⇄ HLS) のシームレス切替は未対応 (画質切替は同一配信形式内のみ)。
- ライブ視聴の m2ts / mp4 / webm 直接再生 (`NormalVideo`) は画質切替の対象外。これらは `<video>` 要素へ無限長ストリームを直接渡しており、切替時の seek 動作が安定しないため。
- 解像度切替しても URL の `?mode=` クエリは更新されない (リロード時は当初のモードに戻る)。
- iOS 26 のホーム画面 Web App 制限は WebKit 側の修正で解除できる見込み。解除時は `StreamSupportUtil.checkM2TSLLSupport()` のバージョン判定を更新すること。

## rigaya 系エンコーダ (QSVEncC / NVEncC / VCEEncC) を使う配信プリセット

`config.yml` の `encodePresets.hwaccel` に `qsvencc` / `nvencc` / `vceencc` を指定すると、
配信プリセットの `cmd` が「rigaya 系エンコーダ → パイプ → ffmpeg で remux」の 2 段構成になる
(`src/util/EncodePresets.ts` の `buildRigayaPipelinePrefix`)。デコード・デインタレース・リサイズ・
エンコードは rigaya 側が担い、fMP4 / HLS セグメントのコンテナ処理は ffmpeg 側に残す
(rigaya 側では `-movflags empty_moov+default_base_moof+frag_keyframe` 等の指定ができないため)。

コマンドを触るときの注意 (3 ツールで CLI が完全に共通ではない):

- コンテナ指定は `--output-format` (別名 `-f`)。`--format` というオプションは存在しない
- `--closed-gop` は 3 ツールいずれにも無い。GOP 長固定は `--strict-gop` (VCEEncC には無い)
- `--vpp-deinterlace` は QSVEncC / NVEncC のみ、かつ `--interlace tff`/`bff` の指定が前提。
  VCEEncC は共通オプションの `--vpp-yadif` を使う
- アスペクト比追従リサイズは `--output-res -2x<height>` (`preserve_aspect_ratio` に `input` という値は無い)
- デュアルモノの主音声選択は rigaya 側では `--audio-copy` のままにし、remux 側の ffmpeg の
  `-dual_mono_mode main` で行う (録画エンコードの `config/enc.js` 側は `--audio-stream FL:stereo`)
- `cmd` に `|` を含むためシェル経由で実行される (Windows は `cmd.exe`)
- **録画ファイルを直接読む cmd (`--seek %SS% -i %INPUT%`) には `--avsync forcecfr --fps 30000/1001` が必須**。
  rigaya 系はファイル先頭付近のタイムスタンプからフレームレートを推定するが、録画 TS
  (特に Amatsukaze の tsreplace 出力) は先頭が不揃いなため推定を外す。実測では 59.94fps のファイルを
  31.75fps (`4540/143`) と誤検出し、その速度で出力するため映像だけが実時間より遅れていった
  (60 秒のソースで映像 51.59 秒 / 音声 58.75 秒)。音声は `--audio-copy` で元のタイムスタンプのまま
  流れるので、ずれは再生時間に比例して開く。
  `--avsync forcecfr` が入力 PTS を見てフレームを挿入・削除し実時間どおりの CFR に揃える (同期の本体)。
  `--fps` は出力レートの固定用で、付けないと誤検出値がそのまま出力レートになり `--gop-len` で決まる
  LL-HLS のパート長がファイルごとに変わる。`forcecfr` と併用する限り再生速度には影響しない。
  パイプ入力 (ライブ・録画中の TS) は放送 TS がそのまま流れるため不要
  (`EncodePresets.FILE_INPUT_SYNC_OPTIONS`)

## in-memory HLS（低遅延・ディスク書き込みなし）

録画済み in-memory HLS のエンコードは、クライアントの再生位置 (`lastServedSeq`) より最大約 150 秒先まで進められる (`RecordedStreamBaseModel.MAX_AHEAD_SEGMENT_NUM`)。保持するセグメントはこの再生位置を基準に、そこから遡って約 120 秒分 (`HLSMemoryStoreModel.RECORDED_KEEP_BEHIND_SEGMENT_NUM`) を切り捨てずに残す (Safari のネイティブ HLS が再生位置から約 50〜60 秒先まで取得・バッファする実測に、巻き戻し操作の余裕を足した値。再生位置が判明する前の起動直後だけ、件数ベースの保持数 (180 セグメント) を暫定基準にする)。以前は「最新から一定件数」だけを保持窓の基準にしていたため、エンコードが先行し続けると保持窓の先頭が再生位置を追い越し、数分再生すると `hls.js` / Safari のネイティブ HLS がライブエッジへ強制シークして再生位置が飛ぶ不具合があった。更新中プレイリストには `#EXT-X-START:TIME-OFFSET=0,PRECISE=YES` を付け、Safari / hls.js がライブ端へ移動せず録画先頭から再生するようにする。hls.js 経路も `startPosition: 0`、`maxBufferLength: 150`、`maxMaxBufferLength: 180` とし、先読み不足によるブツ切れを抑える。サーバーはブラウザが取得した最も新しい seq を先読み基準にし、古いセグメントの再取得では基準を後退させない。ライブ HLS の保持・先読み設定は変更しない。

録画済みのエンコードは実時間より速く進むため、再生が終わるより先に必ずエンコーダが終了する。エンコーダの正常終了 (exit code 0) をそのままストリーム停止に結び付けると、`HLSMemoryStoreModel.delete()` でまだプレイヤーが取得していない末尾のセグメントまで失われてしまう (実測: 9.8 分の録画で 363 秒地点まで再生できていたのに、エンコーダ終了と同時にストアごと削除され、以後再生が戻らなくなった)。そのため正常終了時は `RecordedStreamBaseModel.onStreamProcessExit()` がストリームを止めず `HLSMemoryStoreModel.markEnded()` を呼ぶだけに留め、プレイリストへ `#EXT-X-ENDLIST` を付けて終端を伝える (待機中のブロッキングプレイリスト要求もここで解決する)。ストア自体の破棄はクライアント切断や keep タイマー切れ (`StreamBaseModel.setStopTimer()`、15 秒) による通常の `stop()` に任せる。異常終了 (0 以外の exit code) は録り直しようがないため従来どおり即座に停止する。

録画 M2TS-LL / MP4 / WebM の通常配信も同じ問題を持つ。正常なエンコーダ終了で `RecordedStreamBaseModel` が直ちに `emitExitStream()` すると、実時間より速く読み切った時点で「再生中のストリーム停止」と記録される。正常終了は EOF として扱い、レスポンスの `finish` 後に route が keep タイマーとサーバーストリームを回収する。異常終了やクライアント切断は従来どおり即時停止する。したがって EOF 時点で既に送信済みのブラウザバッファは再生を継続し、未送信データを切り捨てない。

メモリ設計の注意: 録画 HLS は通常 180 セグメント、異常時の安全弁は 1 エントリ 400 セグメント。1 セグメントを約 0.4MB とすると単一音声で最大約 160MB、複数音声レンディションでは映像・音声ロールごとに保持するため最大約 480MB/ストリームになり得る。現在はプロセス数上限による間接制限だけで、全視聴者横断のバイト数上限はない。複数同時視聴時は RSS を実測し、必要ならロール単位・全体単位の上限を別途設計する。今回この上限値自体は変更していない。

ライブ HLS をディスクに書き出さず、メモリ上でセグメント化・配信するモードを追加した。

### 仕組み

- `config.yml` の `stream.live.ts.hls` の `cmd` が `%streamFileDir%` を含まない場合、in-memory モードと判定される（設定スキーマの変更なし・従来のディスク方式もそのまま動作）。
- in-memory モードの `cmd` は fragmented MP4 を標準出力（`pipe:1`）へ書き出すこと（`-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`）。
- サーバー側は `Fmp4Packager` で fMP4 を init セグメント / パート / メディアセグメントに分解し、`HLSMemoryStoreModel`（singleton）に保持する。
- `/streamfiles/stream{id}.m3u8` などのリクエストはまずメモリストアから応答し、存在しない場合は従来どおりディスク（`streamFilePath`）へフォールバックする。
- tmpfs 等 OS 依存の仕組みを使わないため Windows でも動作する。
- **録画済み HLS 配信 (`RecordedHLS`) も同じ判定・同じ `HLSMemoryStoreModel` / `Fmp4Packager` / `/streamfiles/*` エンドポイントを共用して in-memory 化に対応済み** (`stream.recorded.{ts,encoded}.hls` の `cmd` が `%streamFileDir%` を含まなければ in-memory)。判定・パイプライン組み立ては `RecordedStreamBaseModel.isMemoryHLS()` / `startMemoryHLSPackaging()` に実装している (`LiveStreamBaseModel` と同名・同構造)。
  - **`encodePresets` が生成する録画済み HLS プリセットは in-memory (fMP4) がデフォルト**。MPEG-TS セグメントの HLS では iOS / Safari が HEVC を再生できず、LL-HLS のパート分割も fMP4 フラグメント単位でしか実現できないため、`buildRecordedHlsCmd()` は `%streamFileDir%` を含まない fMP4 出力の cmd を生成する。ディスク方式で運用したい場合は `stream.profiles.recorded.*` を手書きすること。
  - 録画側はクライアントが再生位置 (`playPosition`) 付きでストリームセッションを作り直す方式 (シーク = ストリーム再生成) のため、ディスク方式の既存 cmd も `hls_list_size 0` + `delete_segments` のスライディングウィンドウであり、そもそも全編を保持する EVENT プレイリストではない。したがって in-memory 化してもシーク時の挙動 (再生位置からの作り直し) は変わらない。
  - ストアは `create(streamId, 'recorded')` で作る。プレイヤー内での巻き戻しに応えるため、ライブ (掲載 6 / 保持 12 セグメント) より多い 180 セグメントを保持しすべてプレイリストへ載せる。
  - in-memory モードでも ARIB 字幕に対応する (ライブと同じ仕組み)。`ts` 録画の場合、エンコード前の TS を `AribSubtitleTimedMetadataTransform` へ通し、`AribId3Extractor` が ID3 timed metadata を抜き取り、`Fmp4Packager` がパート先頭の version 1 `emsg` box として再多重化する。録画済み HLS は `#EXT-X-PART` を公開しないが、パートのバイト列はセグメントへ連結されるため `emsg` もセグメントへ残る。エンコード済みファイル (`encoded`) には ARIB 字幕が含まれないため対象外。`[AribId3Extractor]` の抽出件数、`[Fmp4Packager]` の保留 metadata 件数・付与バイト数・part 生成数をログで確認できる。
  - メモリ保持・破棄・タイムアウト・`keep()` によるセッション延長は `StreamBaseModel` / `StreamManageModel` を共通で通るため、ライブ HLS と同じ経路でクリーンアップされる (ストリーム停止時に `HLSMemoryStoreModel.delete()` が呼ばれ、ゴミは残らない)。

### 低遅延化

- **パート長 = GOP 長**。fMP4 のフラグメント境界はキーフレーム (`frag_keyframe`) であり、1 フラグメント = 1 パートになるため、`-g` がそのままパート長になる。**遅延を詰めたいときはここを短くする**。QSV (`hevc_qsv`) 実運用で `-g 8` (≒0.27 秒、29.97fps) まで詰めても実測でエンコードが余裕を持って実時間に追いつくことを確認済み (後述の `-flags low_delay` 除去後)。より頻繁な I フレームは同一ビットレートでの実効画質をわずかに下げるトレードオフがある。
- **セグメント長 = パート長 × `partsPerSegment`**。`#EXT-X-TARGETDURATION` は整数秒でしか書けず 1 秒が下限なので、既定は GOP 15 フレーム (≒0.5 秒) × 2 パート = 1 秒セグメントにしている (`LiveStreamBaseModel.LIVE_HLS_PARTS_PER_SEGMENT` / `RecordedStreamBaseModel.RECORDED_HLS_PARTS_PER_SEGMENT`)。
- **ライブ入力に `-re` を付けない**。`-re` は入力をリアルタイム速度に制限するオプションで、Mirakurun から流れてくる TS は元々リアルタイムなので二重の律速になり、遅延だけが増える (低遅延の m2ts-ll 側には元から付いていない)。代わりに `-fflags nobuffer` で ffmpeg 内部の入力バッファリングを抑える。
- **M2TS-LL の生成 cmd は tsreadex 経由だけ解析を 200000 へ短縮する**。`-analyzeduration 200000 -probesize 200000 -fflags nobuffer` を `-i` より前に置き、tsreadex が PAT/PMT を正規化済みの入力で probe 待ちを短くする。tsreadex 無しは `500000` のままにして放送波の構造を解析する。実測は最初の 300KB 出力で 3.9 秒から 3.3 秒、0/100000 は 2.8 秒だが PMT 検出前に走り出す危険があるため不採用。`-flags low_delay` は出力側へ置く。利用者が手書きした cmd は自動変更しない。サーバーログにはクライアントの再生開始時刻が無いため、起動3秒以下・切替3秒以下への効果は Playwright で再測定する。
- ライブのプレイリストウィンドウは 6 セグメント、メモリ保持は 12 セグメント、再生開始は 2 セグメント貯まった時点 (秒数はセグメント長に依存)。
- クライアントの hls.js は `lowLatencyMode: true` / `liveSyncDurationCount: 3` / `maxLiveSyncPlaybackRate: 1` で運用する。`maxLiveSyncPlaybackRate: 1` は `LatencyController` による追いつき再生 (`playbackRate` の書き換え) だけを止めるための指定で、パート単位の取得とブロッキングプレイリスト要求は有効なまま残る。

#### LL-HLS (EXT-X-PART)

真の LL-HLS を実装済み。`Fmp4Packager` が emit するパートをそのまま配信し、セグメント確定を待たずに再生できる。

- **プレイリストのタグ**: `#EXT-X-VERSION:9` / `#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=<PART-TARGET×3>` / `#EXT-X-PART-INF:PART-TARGET=<固定値>` / `#EXT-X-PART:DURATION=…,URI=…[,INDEPENDENT=YES]` / `#EXT-X-PRELOAD-HINT:TYPE=PART,URI=…`。先頭の不揃いなセグメントは通常 HLS のみで公開し、2 本目の実測から `PART-TARGET` を決めてストリーム中は変更しない。公開パートは `0.85 × PART-TARGET` 以上かつ `PART-TARGET` 以下とし、範囲外のセグメントはパートを公開しない。公開パートがまだ無い間は `PART-INF` / `PRELOAD-HINT` を出さない。`PART-HOLD-BACK` は仕様上 `PART-TARGET` の 3 倍以上が必須。
- **パートの URL は `stream{id}-{seq}.{index}.part.m4s`**。セグメントの `stream{id}-{seq}.m4s` と正規表現で衝突しない形にしてある (`ServiceServer.serveInMemoryHLSFile()`)。
- **ブロッキング要求に応える**。`?_HLS_msn=<seq>&_HLS_part=<index>` 付きのプレイリスト要求と、`#EXT-X-PRELOAD-HINT` で指定した未生成パートへの要求は、該当パートが生成されるまでレスポンスを保留する (`HLSMemoryStoreModel.waitForPlaylist()` / `getPart()`)。上限は 6 秒 (`BLOCK_TIMEOUT`) で、遠すぎる未来 (3 セグメント以上先) の要求は待たずに現状を返す。
- **`delete()` は待機中の要求を必ず解決する**。解決せずにエントリを消すと、そのリクエストのレスポンスが永久に返らなくなる。
- **`emsg` (ARIB 字幕) はセグメントではなくパートの先頭に置く**。LL-HLS ではパートが単独で配信されるため、セグメント確定まで待って付けるとパート経由で再生しているプレイヤーに字幕が届かない。セグメントはパートの単純連結なので、パート側に載せた `emsg` はセグメントにもそのまま含まれる (`Fmp4Packager.emitPart()`)。

#### 実運用で発生した「ずっとかくつく」問題の調査経緯と真因

QSV (`hevc_qsv`) での低遅延ライブ HLS 配信で、視聴中ずっと映像がかくつく不具合が発生したことがある。原因調査は難航し、複数の誤った仮説を経て `-flags low_delay` に行き着いた。同種の問題が再発したときのために経緯を残す。

1. **サーバー側 (エンコード速度・セグメント結合) は終始健全だった**。ffmpeg のデバッグ出力 (frame=/speed=) を直接確認したところ、エンコードは常に実時間の 1.0x 強で安定しておりフレームドロップの増加もなし。`Fmp4Packager` が生成する連続セグメントの `tfdt`/`trun` をバイトレベルで解析しても、映像・音声トラックとも境界のタイムコードは完全に連続 (ギャップ・オーバーラップとも 0) だった。**「境目の結合ミス」という仮説は明確に否定された。**
2. **クライアント側の自動計測は複数の手法で食い違う結果になった**。`getVideoPlaybackQuality()` のドロップフレーム数はほぼ 0、Playwright でブラウザを録画して `ffmpeg freezedetect` (無変化 300ms 以上を検出) にかけても再生開始直後の数秒を除き異常なし。ところが `mpdecimate` (80〜200ms 程度の短い一時停止まで検出できる) にかけると多数のイベントが検出され、`requestVideoFrameCallback` で提示フレームのタイミングを直接計測すると、また別の頻度の異常が出た。
   - **この不一致の主因は測定手法自体の限界だった**: Playwright の画面録画は 25fps 固定なのに対し実際の映像は 29.97fps で、フレームレートの不一致がビート周波数のエイリアシングを生み再生とは無関係な「疑似フリーズ」を作り出していた。さらに検証対象がライブ放送だったため、テスト実行のたびに実際の映像内容 (動きの量) が変わってしまい、設定変更の効果と番組内容の違いを混同していた。
   - 結論: **ライブ放送を対象にしたブラウザ内自動計測は、この種の微妙な体感品質の変化を判定する手段として信頼できない。** 同種の切り分けが必要になった場合、録画済みファイル (内容が固定) を対象にするか、素直に人間が実際の画面を見て判断する方が早い。
3. **最終的に効いた変更は `-flags low_delay` の除去だった**。低遅延化の際に `-fflags nobuffer -flags low_delay` を追加していたが、これを `-fflags nobuffer` のみに戻す (`-flags low_delay` を外す) と、実際にユーザーが視聴して「安定した」と確認できた。`-flags low_delay` は ffmpeg の入力側でデコーダの内部バッファ/フレーム並べ替え遅延を無効化するオプションで、放送波の MPEG-2 (インターレース、B フレームを含みうる) との相性が悪く、データ自体は正しくても表示タイミングが不安定になっていたと考えられる。
4. **`-g 24` への変更 (QSV が 0.5 秒 GOP で「厳しい」という当初の申告) も誤診断だった可能性が高い**。`-flags low_delay` を外した状態で改めて `-g 15`→`-g 8` まで詰めても、エンコード速度は一貫して余裕を持って実時間を上回り、体感の不安定さも再発しなかった。当初 QSV の負荷が原因と判断された「かくつき」も、実際には同じ `-flags low_delay` 由来だった可能性が高い。
5. 教訓: **この手の「継続的な微妙な体感品質劣化」の切り分けでは、まずデータの正しさ (エンコード速度・セグメント連続性) を機械的に確認して安心してよいが、そこから先の「体感」の良し悪しは自動計測より実際のユーザーの目が最も信頼できる。** 変更は 1 つずつ行い、都度ユーザーに直接確認してもらうのが最短路だった。

### コーデックの iOS / Safari 互換

HLS を iPhone / iPad / Safari で再生する場合、コーデック側にも制約がある。`src/util/EncodePresets.ts` と `config/enc.js.template` は以下を満たすようにコマンドを組み立てる。

- **HEVC は fMP4 でしか配信できない**。MPEG-TS セグメントの HLS に HEVC を入れても iOS / Safari は再生できない (Apple は fMP4 のみサポート)。`encodePresets` の録画済み HLS プリセットを in-memory fMP4 にしているのはこのため。
- **HEVC の fMP4 / MP4 は必ず `hvc1` タグにする**。ffmpeg の既定は `hev1` で、`hev1` のままだと iOS / Safari で映像が出ない。ffmpeg 直接エンコードは `-tag:v hvc1`、rigaya 系 (QSVEncC / NVEncC / VCEEncC) は **エンコーダ側にコーデックタグを指定する手段が無い**ため、後段の ffmpeg remux (`-c:v copy -tag:v hvc1`) で付ける。録画エンコード (`config/enc.js`) の rigaya HEVC プリセットも、mp4 を直接書かず mpegts を標準出力へ渡して ffmpeg で `hvc1` 付き mp4 に remux する。
- **HEVC は Main プロファイル・8bit 4:2:0 に固定する**。Main10 は端末世代によってハードウェアデコードできない。地上波・BS/CS は元が 8bit なので Main で足りる (`-profile:v main -pix_fmt yuv420p` / rigaya は `--profile main --output-depth 8`)。
- **レベルも明示する**。HEVC は 1080p までが Level 4.1、4K が 5.1。H.264 は 720p 以上で High プロファイル、1080p が Level 4.1。4K の H.264 は iOS のハードウェアデコード対象外なので、`2160p` を使うなら `codecs: [hevc]` にすること。

### 音声トラックの切り替え

二か国語放送の副音声や、複数の音声 ES を持つ録画を再生中に切り替えられる。

- **指定子は 4 種類**: `main` (主音声・既定) / `sub` (デュアルモノラルの副音声) / 数字 (音声 ES のインデックス) /
  `all` (主音声・副音声を両方含める。tsreadex 正規化済みの m2tsll のみ有効。それ以外では `main` と同じ扱い)。
  ストリーム API のクエリ `audioTrack` へ渡す (`GET /api/streams/live/{channelId}/hls?mode=0&audioTrack=sub` など)。
- **デュアルモノラルの副音声は `-map` では選べない**。二か国語放送は「1 つのステレオ ES の左右に主音声・副音声」
  という形で送られるため、副音声の選択は `-dual_mono_mode sub` で行う。音声 ES が複数ある放送では
  `-map 0:a:<n>` で ES 自体を選ぶ。この使い分けは `AudioTrackUtil` にまとまっている。
- **cmd のプレースホルダで展開する**: `%DUALMONOMODE%` (入力オプション、`-i` より前に置く) と
  `%AUDIOMAP%` (出力オプション)。`encodePresets` が生成する cmd と config テンプレートの cmd には
  埋め込んである。**`-dual_mono_mode main` を直書きした手書き cmd では音声を切り替えられない**
  (置換対象が無いだけで従来どおり再生はできる)。`-map 0` を使う cmd (m2ts / m2ts-ll / ディスク HLS) には
  `%AUDIOMAP%` を入れないこと (指定が二重になる)。
- **`%AUDIOFILTER%` の `|` はシェルパイプではない**: encoded の副音声選択で使う
  `pan=stereo|c0=c1|c1=c1` は ffmpeg のフィルタ構文なので、展開時にフィルタ全体を引用する。
  `EncodeProcessManageModel` は引用符内の `|` をシェル経路と判定せず、引用符外の実パイプだけを
  `shell` 実行へ送る。spawn 直前のログは置換後の実コマンドを出す。空の音声プレースホルダは
  オプションと空白ごと除去する。
- **`config.tsreadex` を設定すると生成 cmd の前段へ tsreadex が入る** (`-x 18 -n -1 -a 13 -b 7 -c 5 -u 5`)。
  対象サービスの抽出・映像/音声 PID の固定 (0x0100 / 0x0110 / 0x0111)・デュアルモノラルの分離・
  欠落音声の補完を行うため、放送側で音声構成が変わっても配信は「映像 + 音声 2 本」の固定構造になる。
  **同梱していないため、設定が無い環境では挟まない**。録画ファイル入力 (encoded) は対象外。
  **`-b 5` (無音 AAC の挿入) にしないこと** — EPG が二か国語と言っていても実際の AAC が
  デュアルモノラルでない放送局があり、副音声が完全な無音になる (実測: `-b 5` で -91.0dB、
  `-b 7` で主音声と同じ -28.4dB)。**tsreadex 経由では副音声を `-dual_mono_mode sub` で選べない**
  (2 本の ES に分離済みなので `-map 0:a:1`)。`AudioTrackUtil` が置換前の cmd の `%TSREADEX%` の
  有無で切り替える。
- **録画済み MP4 / WebM も `audioTrack` を付けて再配信する**。ffprobe がデュアルモノラル 1 ES を主音声・副音声へ展開した場合、encoded の `sub` はサーバー側 ffmpeg の `pan` で右チャンネルを左右へ複製する。生 TS / tsreplace の m2tsll は従来どおり、tsreadex 無しなら `dual_mono_mode`、tsreadex 有りなら分離済み ES の map を使う。クライアントは再生開始後も音声一覧を保持し、画質切替・シーク後に選択状態を再適用する。
- **m2tsll は `-map 0` / `-map "0:d?"` / 入力側 ID3 map を使わない**。相乗りサービスの文字スーパー (PID 0x138、
  ffmpeg 上は PTS の無い `bin_data` / `private_stream_2`) が一括 map で拾われると mpegts muxer が
  インターリーブ待ちで数フレームだけ書き出した後に完全停止する (実測: ffmpeg 9.0.1、libx264 は 161
  フレーム出力済みなのに mux 済みは frame=5 のまま)。tsreadex の有無によらず
  `-map 0:v:0 %AUDIOSELECTMAP% -map "0:s?" -c:s copy` (映像・音声・ARIB 字幕 ES のみ map) にする。
  **ディスク HLS は今回変更していない**
  (`%AUDIOMAP% -map "0:s?" -map "0:d?"` のまま) — 同じ問題を抱えうるが、リアルタイムの pipe mux (m2tsll)
  と挙動が異なる可能性があり実測で確認できていないため現状維持。`?` はシェルの glob 文字なので
  引用符が要る。設定例の外側引用符は両経路で共通に残し、`ProcessUtil.parseCmdStr()` が直接 spawn
  の引数だけ外す。シェル経路では引用符をそのまま `/bin/sh` / `cmd.exe` へ渡す。これにより tsreadex
  未設定のライブ m2tsll と、録画 TS / encoded の m2tsll を含む全自動生成経路が起動できる。
- **HEVC TS の ARIB 字幕 ID3 化は専用変換器で行う**。`arib-subtitle-timedmetadater@4.0.10` は PMT の `stream_identifier_descriptor (0x52)` の `component_tag=0x30〜0x37` / `0x87` だけを字幕として認識し、映像 codec 自体は参照しない。`0x38〜0x3f` は文字スーパー等の別 ES として扱う。EPGStation は `stream_type=0x06` の `subtitling_descriptor (0x59)` と従来の component tag を認識する `AribSubtitleTimedMetadataTransform` で PMT と ID3 PES を直接生成する。`data_group_id` は字幕管理・本文の `0x00〜0x08` / `0x20〜0x28` を受理し、PTS の無い PES は時刻を推測せず破棄する。MPEG-2 / H.264 の従来 component tag 判定も維持する。
- **m2tsll の TS 入力は ID3 (ARIB 字幕) をエンコード後 (出力側) に挿入する**。
  入力側へ ID3 timed metadata (PID `0x1FFE`) を map すると、字幕が疎な区間で mpegts muxer がインターリーブ待ちになり、
  配信速度が異常に落ちる。ブラウザを使わない同一経路の実測で、ID3 map 有りは `speed=0.068x` / `fps=1.6` / 12 秒分の出力に実時間 2 分 56 秒、
  ID3 map 無しは `speed=13.9x` / `fps=237` / 実時間 1.19 秒だった。`ss=366` は 20 秒取得で 86,668 bytes / 1 frame、
  `ss=1471` は 10 秒取得で 12,644,316 bytes / 731 frames となり、位置依存の停止を説明する。
  `LiveStreamBaseModel` / `RecordedStreamBaseModel` は、tsreadex の有無によらず m2tsll の TS 入力だけで、
  `streamProcess.stdout` (`-c:s copy` 済みの ARIB 字幕 ES を含む) へ `AribSubtitleTimedMetadataTransform` を挿入する (`getStream()` はこの Transform を返す)。
  QSVEncC 等の再エンコード後 stdout も HEVC になり得るため、入力側ではなく出力側で同じ変換を行う。
  encoded 入力は対象外。mp4 / webm / HLS (ディスク・in-memory とも) は従来経路を維持する。
- **M2TS-LL のクライアント側修正は別問題**。MSE / mpegts.js の再生成、188 byte 境界、再生位置競合はそれぞれ別の改善であり、
  `ss=366` / `642` / `91` だけで発生する今回の固着の主因ではない。
- **`audioTrack=all`**: tsreadex 正規化済みのときだけ `%AUDIOSELECTMAP%` を
  `-map 0:v:0 -map 0:a:0 -map 0:a:1` に展開し、主音声・副音声の両方の ES を同時に配信する。
  m2tsll でクライアント (mpegts.js) が再接続無しに `switchPrimaryAudio()` / `switchSecondaryAudio()`
  を呼んで切り替えるための経路 (下記「再接続無しの音声切替」参照)。tsreadex 無しで `all` が来た場合は
  デュアルモノラルの 1 ES しか無く分離できないため `main` と同じ扱いにする。
  **tsreadex 正規化済みで `audioTrack` が未指定の場合は index 0 (主音声 ES) を明示的に選ぶ**
  (未指定のまま `%AUDIOMAP%` を空にすると、`-map 0` を持たない m2tsll の cmd では映像・音声が
  1 本も map されず配信が始まらない)。
- **cmd を生成するコードにも同じプレースホルダを埋める**。`cmd` を省略した配信プリセットは
  `StreamProfileManageModel.buildCmd()` が、新経路は `LiveCommandBuilder` / `RecordedCommandBuilder` が
  コマンドを組み立てる。ここで `-dual_mono_mode main` を直書きすると置換対象が消え、
  **API が `audioTrack` を受け取っていても黙って主音声のまま再生される** (実際にそうなっていた)。

#### 再接続無しの音声切替 (tsreadex 経由の m2tsll / in-memory HLS)

- **`PlaybackProfile.embeddedAudioSwitch`**: コンテナ別に「主音声・副音声を再接続無しで同時配信できるか」
  を示す (`Partial<Record<'m2ts'|'m2tsll'|'mp4'|'webm'|'hls', boolean>>`)。`PlaybackApiModel` が該当
  コンテナの実プロファイルの cmd (cmd 省略時は `StreamProfileManageModel` が生成した後の cmd、
  `IStreamPresetRegistry.resolveProfileCmd()` で取得) を見て、`%TSREADEX%` と音声選択用
  プレースホルダ (`%AUDIOMAP%` または `%AUDIOSELECTMAP%`) を両方含み
  コンテナが m2tsll のとき、または in-memory HLS (cmd が `%streamFileDir%` を含まない) のとき true にする。
  ディスク方式の HLS は対象外。
- クライアント (`LiveMpegTsVideo.vue` / `RecordedStreamingVideo.vue`) は再生中モードで `embeddedAudioSwitch.m2tsll === true` なら、
  配信 url を `audioTrack=all` で開き、音声パネルからの選択は再接続せず
  `dp.plugins.mpegts.switchPrimaryAudio()` / `switchSecondaryAudio()` を直接呼ぶ。画質切替で
  mpegts.js インスタンスが作り直された直後 (新インスタンスは常に主音声から始まる) は、選択中が
  副音声なら `switchSecondaryAudio()` を再適用する。`embeddedAudioSwitch` が false / 不明なモードでは
  従来どおり「audioTrack を変えた url へ差し替えて読み直す」方式にフォールバックする。
- **HLS (`LiveHLSVideo.vue` / `RecordedHLSStreamingVideo.vue`) も同じ流儀**。`audioTrack=all` で開くと
  サーバーは「映像レンディション + 音声レンディション 2 本」のマスタープレイリストを返すので、切替は
  hls.js なら `hls.audioTrack = <index>`、Safari のネイティブ HLS なら `video.audioTracks[i].enabled` で行う
  (`client/src/util/HlsAudioTrackUtil.ts`)。画質切替・シークでストリームを作り直した後は選択中の音声を選び直す。
- 録画 HLS の画質切替は `VirtualTimeline` の絶対再生位置を次のストリームの `playPosition` に渡し、DPlayer の `switchVideo` 経路で新しいストリームの先頭を再生する。字幕・チャプター・データ放送の再適用は既存の `canplay` / シーク処理に任せ、別のプレイヤーを生成しない。通常プレイリストでは最初のパート到着だけでクライアント取得を開始できないため、録画の `enable` をパート単位へ前倒しする変更は行わない。録画シーク 2 秒以下はサーバーの start→enable 1.05〜1.25 秒以外の約1.3秒を再測定し、必要なら短い GOP の影響を別途評価する。
- **主音声を選んでいる間は `embeddedAudioSwitch` が未取得でも `audioTrack=all` で開く**。
  `playbackProfiles` はプレイヤー生成後に非同期で届くため、最初の url を組む時点では空のことが多い。
  サーバーは tsreadex を通さない cmd では `all` を `main` として扱うのでどの構成でも安全。

#### in-memory HLS の複数音声レンディション

- `Fmp4Packager` は init (moov) の trak 構成を見て**音声 trak が 2 本以上あるときだけ**トラック分解モードに入り、
  trak ごとの init と trackId 別の moof + mdat を切り出す。音声 1 本の従来構成は分解せず出力を変えない。
  ARIB 字幕の `emsg` は映像ロールのパート先頭にだけ付ける。
- URL は `stream{id}.m3u8` (マスター) / `stream{id}v.m3u8` / `stream{id}a0.m3u8` / `stream{id}a1.m3u8` /
  `stream{id}{role}-init.mp4` / `stream{id}{role}-{seq}.m4s`。
- **マスタープレイリストの `CODECS` は必須**。無いと Safari のネイティブ HLS が映像 + 別音声レンディションを
  再生できない (実測: WebKit 26 で audioTracks は 2 本見えるのに再生位置が 0.4 秒から進まない)。値は
  init セグメント (stsd の avc1 / hvc1 / mp4a) から読む (`llhls/Mp4CodecUtil.ts`)。
- **複数音声のレンディションは LL-HLS にしない** (`#EXT-X-PART` / `#EXT-X-PRELOAD-HINT` を出さない)。
  パート付きで配ると Safari が音声レンディションを先頭セグメントまでしか取得せず再生が止まる
  (実測: WebKit 26 で `currentTime` が 0.45 秒のまま `readyState=2`)。単一音声のライブは LL-HLS のまま。
- **ライブの一覧は `GET /api/channels/{channelId}/audio-tracks`**。ライブには ffprobe をかける実ファイルが
  無いため、放送中番組 (EIT[p/f] 反映済み) の音声 ES 一覧 (Mirakurun の `audios[]`、DB は `program.audios`) から
  組み立てる。デュアルモノラル (`componentType` = 0x02) の ES 1 本は主音声・副音声の 2 件へ展開し、
  複数音声 ES はそれぞれ独立した音声として index を振る。通常のステレオ放送は空配列を返して切替 UI を出さない。
  **番組情報が取れない放送局のため、クライアントは一覧が空のときだけ**主音声・副音声の 2 択へ落とす。
- **録画の一覧は `GET /api/videos/{videoFileId}/audio-tracks`** が ffprobe を使って返す。
  音声 ES が 1 つだけのステレオは、二か国語放送の可能性があるため主音声・副音声の 2 件へ展開する
  (ただのステレオ放送だった場合、副音声を選ぶと右チャンネルが両耳に出るだけで再生自体は続く)。
- **切り替えはストリームの作り直し**になる (エンコード済みの音声を後から差し替えられないため)。
  クライアントは画質切替と同じく、現在の再生位置でストリームを再生成してから url を差し替える。

### 配信音声ブースト

`audioBoost` を指定すると、ライブ・録画再生の再エンコード配信音声へ `volume` フィルタを適用する。
既定値は `2.0`、有効範囲は `1.0`〜`4.0`。`1.0` ではフィルタを付けない。

**フィルタは音声を aac へ再エンコードする ffmpeg のコマンドへ入れる** (`-af volume=<倍率>`)。
rigaya 系 (QSVEncC / NVEncC / VCEEncC) を使うプリセットも同じで、rigaya 側は `--audio-copy` のまま触らない
— rigaya の `--audio-filter` は音声を再エンコードする場合 (`--audio-codec`) にしか効かず、`--audio-copy` とは併用できないため。
EPGStation の rigaya プリセットは「rigaya が映像だけ処理 → 後段の ffmpeg が音声を aac 化」というパイプラインなので、
ブーストは後段 ffmpeg が担当する。音声コピーのみの経路と保存用 `encode` には適用しない。

配信用 cmd (`stream.profiles.*`) では `%AUDIOFILTER%` を置くと、音声トラック指定とブーストを 1 本の
`-af` へ統合して展開する (`%DUALMONOMODE%` / `%AUDIOMAP%` と同じ扱い)。`-af` を複数指定すると後勝ちで
前のフィルタが無効になるため、pan と volume を別々に置かない。

録画済みの明示 cmd も MP4 / WebM / m2tsll / HLS の全コンテナで `%DUALMONOMODE%` と音声 map
(`%AUDIOMAP%` または `%AUDIOSELECTMAP%`) に加えて `%AUDIOFILTER%` を残す。特に encoded の `sub` は
`%AUDIOFILTER%` が無いと `AudioTrackUtil` が `pan` を挿入できず、API が `audioTrack=sub` を受けても
主音声と同じ音になる。`config.yml` の明示 cmd を変更するときも同じプレースホルダを維持する。

録画ファイルの `%INPUT%` と `%OUTPUT%` は `EncodeProcessManageModel` が spawn 直前に置換する。
ストリーム側で置換前 cmd をログへ出すと実行 cmd と異なるため、ログは置換後の shell 文字列または spawn 引数を
記録する。ログに `%INPUT%` が残る場合は生成失敗ではなく、古いログ出力経路または古い配備物を疑う。

録画済みの encoded 入力で副音声を選ぶ場合、放送 TS のデュアルモノラルではなく通常のステレオ AAC
（左=主、右=副）なので、`%AUDIOFILTER%` は `pan=stereo|c0=c1|c1=c1` を生成する。TS 入力とライブは
従来どおり `-dual_mono_mode sub` を使う。主音声には pan を掛けず、通常のステレオ放送をモノラル化しない。

ファイル直接再生 (`NormalVideo`) は、`audioTracks` が複数なら従来どおりブラウザの実トラックを使う。
実トラックが 1 本でもサーバーの音声トラック API がデュアルモノラルを返す場合は Web Audio API で L/R を分け、
副音声選択時だけ右チャンネルを左右へ複製する。Web Audio 非対応・グラフ生成失敗時は UI を表示せず通常再生を維持する。
- UI は **DPlayer の設定 > 音声パネルの DOM を流用**している (`DPlayerEnhancer`)。DPlayer 標準の実装は
  mpegts.js / hls.js のトラックを直接叩くものなので、項目の生成とクリック時の動作を差し替えている。

### チャプター

エンコード済みファイルのチャプターをシークバー上へ表示する。

- **`GET /api/videos/{videoFileId}/chapters`** が `ffprobe -show_chapters -show_format` の結果を返す。
  DB には保存せず要求のたびに読み出す (1 ファイルあたり数十 ms で終わるため)。
- **MPEG-TS コンテナはチャプターを埋め込めない**。Amatsukaze の tsreplace 出力 (`*.hevc.ts`) のように
  `.ts` のまま残す構成では、チャプターが `<動画ファイル名>.chapter.txt` へ別途書き出される。
  ffprobe が 0 件を返した場合はこのファイルを読む (`ChapterFileUtil`)。形式は Ogg / Matroska の
  simple chapter format (`CHAPTER01=00:00:00.000` / `CHAPTER01NAME=A`) で、
  終了位置を持たないため `endAt` は次のチャプターの開始位置 (最後の 1 件は動画全体の長さ) で埋める。
- **録画サムネイルでも同じ `VideoUtil.getChapters()` を使う**。エンコード済み動画だけを対象に、タイトルが
  trim後 `CM` で始まる区間と境界前後0.5秒を候補から除外する。埋込・sidecarのどちらでも同じ判定になる。
  全候補がCMなら非CMチャプター中央へ補完し、チャプターが全件CM・無効なら生成不能を避けて通常候補へ戻す。
- **DPlayer に `highlight` を渡せるのはプレイヤー生成時だけ**なので、チャプターは
  `createPlayer()` の前に取得しておく (`BaseVideo.applyChapterHighlights()`)。ファイルを直接再生する
  `NormalVideo` だけは動画長が `loadedmetadata` まで分からないので、読み込み後に自前でマーカーを描き足す。
- **ストリーミング再生のマーカーは `VirtualTimeline` が描く**。DPlayer は `durationchange` のたびに
  マーカーを作り直し、位置を `time / video.duration` で決める。ストリーミングの `video.duration` は
  「エンコードが済んだところまでの長さ」なので、放置するとエンコードが進むたびにマーカーが左へ動く。
  `VirtualTimeline` が `options.highlight` を取り上げて DPlayer 側の再描画を止め
  (この値が無ければ DPlayer はマーカーに一切触らない)、動画全体の長さを分母にして位置を更新する。
- キーボードの `[` / `]` で前後のチャプターへ移動できる。

### mpegts 配信 (m2ts / m2ts-ll) の ARIB 字幕

- **DPlayer は mpegts.js の `TIMED_ID3_METADATA_ARRIVED` からしか aribb24 へ字幕を渡さない**。TS に ARIB 字幕 ES (PID 0x130 等) がそのまま入っていても字幕は表示されない。そのため mpegts 配信でも HLS と同じく `AribSubtitleTimedMetadataTransform` を使う。m2tsll は字幕 ES をエンコーダへ渡し、エンコード後の stdout に ID3 timed metadata (PID 0x1ffe) を挿入する (`LiveStreamBaseModel` / `RecordedStreamBaseModel`)
- **エンコード後は字幕 ES を残し、ID3 は出力側で生成する**。m2ts-ll の自動生成コマンドは tsreadex の有無によらず `-map 0:v:0 %AUDIOSELECTMAP% -map "0:s?" -c:s copy` で ARIB 字幕 ES を map する。`LiveStreamBaseModel` / `RecordedStreamBaseModel` が stdout の TS を `AribSubtitleTimedMetadataTransform` へ通し、PID `0x1FFE` の ID3 timed metadata を出力へ付ける。入力側で ID3 を map すると疎な字幕区間で muxer が固着するため、`Data: timed_id3` はこの出力側経路で作られる
- ID3 変換は PMT を書き換えるため、`-map` を使う設定では出力の PID 構成も変わる
- **m2tsll の TS 入力は tsreadex の有無によらず出力側 ID3 経路を使う**。m2ts (m2tsll 以外) の既存 tsreadex 経路は従来どおり。詳細は上の「音声トラックの切り替え」節を参照

### 制限事項

- in-memory モードの字幕は `emsg` box (`scheme_id_uri = https://aomedia.org/emsg/ID3`) で運ぶ。fMP4 には ARIB 字幕 ES / ID3 ES をそのまま多重化できないため、エンコード前の TS から ID3 timed metadata を抜き取り、パート先頭へ `emsg` として付け直す方式を採っている (`AribId3Extractor` → `Fmp4Packager.pushId3()`)。hls.js は `emsg` を ID3 として通知するため、クライアント側 (aribb24) の実装はディスク方式と共通。
- 上記の性質上、字幕の絶対時刻はエンコードパイプラインの遅延分 (おおむね 1 秒程度) だけずれることがある。フレーム単位の同期が必要な場合は従来のディスク方式 cmd を使用すること。
- 字幕を正しく扱うため、入力 TS は `tsreadex` を通すこと (ワンセグ/字幕の PID 整合やドロップ耐性のため推奨)。cmd の先頭に `%TSREADEX% ... |` を置く形を推奨する。tsreadex 無しの m2tsll も、字幕 ES を map して出力側で ID3 化するため利用できる。
- メモリ保持はライブが直近 12 セグメントで、ストリーム停止時に即時解放される (`HLSMemoryStoreModel.LIVE_RETAIN_SEGMENT_NUM`)。録画済みは再生位置 (`lastServedSeq`) が判明するまでは直近 180 セグメントを暫定保持し (`RECORDED_RETAIN_SEGMENT_NUM`)、判明した後は再生位置から遡って約 120 秒分を保持する (`RECORDED_KEEP_BEHIND_SEGMENT_NUM`。詳細は上の「保持窓」節を参照)。どちらのモードも、まだクライアントが取得していないセグメントは保持上限だけを理由に削除しない (メモリ使用量の安全弁として `RECORDED_MAX_SEGMENT_NUM` (400 セグメント) を超えた場合だけは、未取得でも破棄する)。録画済みで保持範囲を超えて巻き戻す操作は、従来どおりクライアント側でストリームを作り直して対応する。
- **録画済みはエンコードを再生位置の近くに留める**。録画ファイルのエンコードは実時間の数倍速で進むため、放置すると再生位置との差が際限なく開く。hls.js は録画済みのプレイリストも live 扱いで読む (エンコーダ動作中は `#EXT-X-ENDLIST` が無い) ため、再生位置が保持窓の外に出ると `StreamController.synchronizeToLiveEdge()` が `media.currentTime` をライブエッジ = エンコード最新位置へ書き換えてしまう (`liveMaxLatencyDurationCount` の既定は `Infinity` なので、発火するのは遅延しきい値ではなくこちらの条件)。`HLSMemoryStoreModel.getAheadSegmentNum()` がクライアントの取得済み seq からの先行量を返し、`RecordedStreamBaseModel` が 150 セグメント (`MAX_AHEAD_SEGMENT_NUM`) を超えたらエンコーダの標準出力の読み出しを止める。ブラウザが消費して先行量が 30 セグメント (`RESUME_AHEAD_SEGMENT_NUM`) まで減れば再開する。減らなくても、その時点の超過量に比例して計算した停止時間 (`pauseTime`。上限 `MAX_PACE_INTERVAL` = 5 秒) が経過すれば必ず再開する。パイプが詰まってエンコーダ自身が書き込みでブロックするため、追いつけば読み出しを再開するだけで戻る。先行分はシークに即応できる範囲でもあるので短くしすぎないこと。
- **ただし完全に止めてはいけない (デッドロックになる)**。エンコードを止めるとプレイリストの更新も止まるが、LL-HLS のプレイヤー (特に iOS Safari のネイティブ HLS) は**ブロッキングプレイリスト要求 (`?_HLS_msn=<次の seq>`) の応答が変化してから次のセグメントを取得する**ため、更新が止まると新しいセグメントを取りに来なくなる。先行量の基準である `lastServedSeq` はクライアントが取得した最新 seq なので、取りに来なければ先行量も減らず、エンコードは永久に再開しない (画面は再生が止まったまま、サーバー側は `keep` が届き続けるので何のエラーも出ない)。そのため抑制中は先行量を定期確認し、30 セグメントまで減った時点で再開する。減らない場合も `pauseTime` の経過で必ず再開し、更新停止によるデッドロックを防ぐ。**再開判定のループ上限は固定の `MAX_PACE_INTERVAL` ではなく、その時点で計算した `pauseTime` を使う**。固定値にすると、超過量がわずかで `pauseTime` が短く計算された場合でも常に上限の 5 秒まで停止が引き延ばされてしまう (先行量は視聴の実時間経過でしか減らないため、短い `pauseTime` 内では `RESUME_AHEAD_SEGMENT_NUM` まで下がりきらず、ループが際限なく延長され続けていた)。**一定時間ごとの粗い ON/OFF (例: 1 秒止めて再開) にしてはいけない** — 停止中もエンコーダはパイプバッファへ書き込み続け、再開時に一気に流れ込むため、配信が「バーストと空白の繰り返し」になり再生がとびとびになる。
- **PMT は 1 TS パケットに収まるとは限らない**。`AribSubtitleTimedMetadataTransform` は PMT に metadata の記述子と ES を書き足すため、元の PMT が大きい放送局 (NHK 等) では 184 byte を超えて分割される。`AribId3Extractor` は PSI セクションを `section_length` まで組み立ててから解釈する。ここを先頭パケットだけで済ませると **metadata の PID を検出できず字幕が 1 つも出ない**。
- **ID3 の PES は `PES_packet_length` で確定させる**。次の PES 到着を待つ実装にすると、字幕の間隔 (数秒〜数十秒) だけ表示が遅れて実質出ないのと同じになる。
- **PES ヘッダの 33bit PTS はビット演算で組み立てられない** (JavaScript のビット演算は 32bit に丸められる)。`AribId3Extractor.parsePes()` は各フィールドを重み `2^30 / 2^22 / 2^15 / 2^7 / 2^0` で足し合わせて復元する。ここを間違えると字幕の表示タイミングだけがずれる (映像・音声は ffmpeg 側が扱うため気づきにくい)。テストは `test/ut/arib-id3-extractor.test.js`。
- `Fmp4Packager` の emsg box は `scheme_id_uri` に `https://aomedia.org/emsg/ID3` を使う。この文字列自体に `emsg` が含まれるため、**バイト列を文字列検索して emsg の数を数えてはいけない** (box を辿って数えること)。
- **emsg box は必ず version 1 で出力する**。hls.js の `parseEmsg()` は version 0 のとき `version + flags` の 4 byte を読み飛ばさずに `scheme_id_uri` の読み取りを始めるため、先頭が必ず `0x00` になる version 0 の emsg は `scheme_id_uri` が空と解釈され、ID3 スキーム判定 (`/\/emsg[-/]ID3/i`) を通らない。結果として `FRAG_PARSING_METADATA` が 1 度も発火せず、**セグメントに emsg を正しく載せていても字幕が一切表示されない**。version 1 のパスのみ 4 byte を読み飛ばす実装になっている (hls.js 1.6.16 で確認)。
- version 1 の emsg は相対時刻 (`presentation_time_delta`) ではなく**メディアタイムライン上の絶対時刻 (`presentation_time`, 64bit)** を持つ。`Fmp4Packager` はセグメント先頭パートの `tfdt` (baseMediaDecodeTime) を基準に、ID3 の PTS (90kHz) の差分をトラックの timescale へ換算して載せる。ID3 の PTS はエンコード前の TS のものでメディアタイムラインとは基準が異なるため、絶対値をそのまま入れてはいけない。

### エンコードオプションのチューニング / HEVC / tsreadex

- H.264 は `-maxrate` + `-bufsize`（ビットレートの 2 倍）で VBV 制限をかけ、ライブ配信でのビットレートスパイクによるバッファリングを抑制。`-profile:v high` + `-level` 指定で圧縮効率を改善（1080p: 5000k / 720p: 3000k / 480p: 1500k）。
- HEVC (libx265) の例をコメントで同梱。`-tag:v hvc1` は Safari / iOS 再生に必須。`-x265-params scenecut=0:repeat-headers=1` で固定 GOP とセグメント単位のデコード開始を保証。ビットレートは H.264 の約半分。
- `cmd` に `|` を含む場合はシェル経由（Windows: cmd.exe / その他: /bin/sh）で実行されるため、`%TSREADEX% ... - | %FFMPEG% ...` のような tsreadex 前処理パイプラインが使える。`%TSREADEX%` は config の `tsreadex`（省略時は PATH 上の `tsreadex`）に置換される。
- シェル実行時の停止はシェルプロセスへの kill → パイプ閉じにより下流プロセスも連鎖終了する。

## 全配信方式での画質切替 (DPlayer quality メニュー)

M2TS-LL のみだった画質切替を、**ライブ HLS・録画 HLS・録画ストリーミング (mp4 / webm)** にも拡張した。
DPlayer 標準の設定メニュー (歯車 → 画質) から `config.yml` の視聴設定 (mode) を切り替える。

### 対応状況

| 再生方式                          | コンポーネント                  | 参照する config                           | 切替方式                                                                 |
| --------------------------------- | ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| ライブ M2TS-LL                    | `LiveMpegTsVideo.vue`           | `stream.live.ts.m2tsll`                   | URL に `?mode=` を含むだけなので DPlayer 標準の切替                      |
| ライブ HLS                        | `LiveHLSVideo.vue`              | `stream.live.ts.hls`                      | ストリームセッションを停止 → 新 mode で再作成 → 新しい m3u8 へ差し替え   |
| 録画 HLS                          | `RecordedHLSStreamingVideo.vue` | `stream.recorded.{ts,encoded}.hls`        | 現在の再生位置でセッションを作り直し、先頭 (= 切替前の再生位置) から再生 |
| 録画 M2TS-LL                     | `RecordedStreamingVideo.vue`    | `stream.recorded.{ts,encoded}.m2tsll`    | `?mode=` / `?ss=` / `?audioTrack=` を付け直した MPEG-TS URL へ差し替え  |
| 録画 mp4 / webm                   | `RecordedStreamingVideo.vue`    | `stream.recorded.{ts,encoded}.{mp4,webm}` | `?mode=` と `?ss=` (現在の再生位置) を付け直した URL へ差し替え          |
| ライブ m2ts / mp4 / webm 直接再生 | `NormalVideo.vue`               | —                                         | 非対応 (既知の制限を参照)                                                |

- 録画側は `videoFile.type` (`ts` / `encoded`) で参照する設定を切り替える。判定は `IRecordedStreamingVideoState.getVideoFileType()` (取得済みの `RecordedItem.videoFiles` から解決)。
- 設定一覧の取得は `client/src/util/StreamQualityUtil.ts` に集約 (`getLiveModeNames()` / `getRecordedModeNames()` / `createQualityList()`)。Safari 用に設定を間引く `ServerConfigModel` の結果をそのまま使うため、再生できない設定は画質リストにも出ない。
- 視聴設定が 1 件も無い (config 未設定) 場合は従来どおり `video.url` 単体で生成し、画質メニューは表示されない。

### 非同期切替の仕組み (`BaseVideo.setupQualitySwitch()`)

DPlayer の `switchQuality()` は「quality リストに事前登録された URL へ即座に差し替える」前提だが、HLS 配信は
サーバー側でストリームセッションを作り直すまで m3u8 の URL (`stream{streamId}.m3u8`) が決まらない。
そのため `BaseVideo` で `dp.switchQuality` をラップし、以下の順で処理する。

1. 多重実行を防ぐフラグを立て、「画質を … に切り替えています…」を DPlayer の notice で表示
2. `resolveUrl(mode)` で URL を解決 (HLS はここで stop → start → 有効化待ち)
3. `options.video.quality[mode].url` を書き換えてから DPlayer 本来の `switchQuality()` を呼ぶ
4. 失敗時は notice でエラー表示のみ (再生中の映像はそのまま継続)

画質切替完了処理は DPlayer の実装上、速度項目 `.dplayer-setting-speed-current` と音声項目
`.dplayer-setting-audio-current` が必ず1つあり、それぞれ `dataset.speed` / `dataset.audio` を持つ前提で動く。
`DPlayerEnhancer` は独自音声項目へ `dataset.audioTrack` (EPGStationの指定子) と
`dataset.audio` (`primary` / `secondary`) を設定し、選択不一致時は先頭項目を選ぶ。音声項目が1件以下で
DPlayer標準項目を残す場合も、選択中クラスを1つだけ維持する。EPGStation独自の `onSelect` と、DPlayerの
画質切替後の標準音声復元は別経路であり、後者へ必要な値を提供するだけなので二重の音声切替は行わない。
`quality_end` では音声項目を再同期するため、切替に伴うパネル再構築後も選択表示を失わない。

ストリーミング再生では最終描画に DPlayer 標準の `timeupdate` 値を使わず、時刻表示とシークバーを
`VirtualTimeline` が描く。DPlayer は画質切替の `initVideo()` ごとに匿名の標準 `timeupdate`
listener を追加するため、`VirtualTimeline` は `initVideo()` 完了後に自身の listener を一度外して
再接続する。これにより標準描画より常に後で描画し、同じ DPlayer 内の旧標準 listener が残っていても
ストリーム先頭基準の値が絶対位置を上書きしない。`VirtualTimelineListenerController` が接続状態と
1 個制約を管理し、DPlayer 破棄時に解除する。録画 HLS / 録画 M2TS-LL・MP4・WebM / ライブの
画質切替、シーク、レジュームで共通に適用する。

同じ切替でvideo要素が作り直される間、aribb24.js のrendererへ幅または高さ0のvideoからID3/Cueを渡さない。
`BaseVideo` が新rendererの `pushID3v2Data` / `pushID3v2Cue` / `refresh` をガードする。
M2TS-LLでは旧mpegts.jsだけを新videoのcanplayまで保持し、旧aribb24 rendererは新renderer生成直後に破棄する。
HLSではDPlayer標準のrenderer破棄に同じ入力ガードを加える。これで字幕描画のcanvasサイズ0例外を防ぐ。

`resetCurrentTime: true` を指定した場合 (録画系) は、DPlayer が行う「切替前の再生位置への seek」を抑止し、
新しいストリームの先頭から再生させる (ストリーム自体を再生位置から作り直しているため)。

### M2TS-LL 再接続後のバッファ先頭復帰 (補助処理)

録画 M2TS-LL はシーク・レジューム・画質切替・音声再接続で MPEG-TS ストリームを作り直す。
`ss` から始まる新ストリームの先頭 PTS が 0 ではない場合、video の `currentTime=0` が
`buffered.start(0)` より手前に残り、`paused=false` でも再生が進まないことがある。これは
`buffered` が既に存在する再生成後のタイムラインずれだけを扱う補助処理である。
mpegts.js の `StartupStallJumper` は初回起動時に一度だけ使われるため、フォーク側の
`BaseVideo.setupMpegtsPlaybackRecovery()` が `initVideo()` の再生成後へ監視を追加する。

- `readyState >= 2`、`currentTime` が 1 秒以上進んでいない、`currentTime < buffered.start(0) - 0.05`、
  `buffered` が有効、の全条件を満たすときだけ `buffered.start(0)` へ寄せる
- `currentTime` が 0.05 秒超進んだら無進行時計をリセットする。正常再生中の巻き戻しを防ぐ
- `buffered=[]` の初期化停止や、1回のシークで複数ストリームを要求する競合はこの監視では直さない
- 録画シークは `VideoContainer.applyResumePosition()` の非同期レジュームと `VirtualTimeline.onDragEnd()` の手動シークが同じ `setCurrentTime()` へ到達する。手動シーク開始時にレジューム世代を無効化し、`RecordedStreamingVideo.createVideoSrc()` と録画 HLS API の `ss` を `normalizeStreamPlayPosition()` で整数秒へ統一する
- 初回生成は `StartupStallJumper` に任せ、mpegts.js 本体と SHA 固定は変更しない
- 復帰時は `[EPGStation][playback-recovery]` の `console.debug` を出す
- 録画の初回再生バッファゲート (`INITIAL_PLAYBACK_BUFFER_SEC = 8`) は初回 `play()` 開始までだけ有効で、
  `initVideo()` の再生成後には再び有効化しない。ライブ M2TS-LL も同じ復帰監視を画質・音声再接続へ適用する

### 録画 TS の byte seek

録画 TS を入力にする M2TS-LL / mp4 / webm は、ffmpeg の入力へ `pipe:0` で渡すため、
`RecordedStreamBaseModel` が再生位置から開始 byte を計算してファイル reader を作る。
計算値は `bitRate * playPosition / 8` を基準に、0 未満とファイル長超過をクランプし、
188 byte の TS パケット境界へ切り下げる。各ストリーム要求は provider から新しい
`RecordedStreamBaseModel` を得て、新しい reader をこの絶対位置から作る。前回の再生位置や
reader の offset は次の要求へ持ち越さない。

info ログには `estimatedOffset` (境界調整前)、`readStart` (reader が実際に指定する開始位置)、
`fileSize`、`videoFileId`、`playPosition` を出す。ログ例:

```
create recorded file stream: /recordings/example.ts (videoFileId: 31024, playPosition: 91s, estimatedOffset: 123456789, readStart: 123456780, fileSize: 987654321)
```

encoded の mp4 / webm はファイルを直接入力する方式で、従来どおり `-ss %SS% -i %INPUT%` を使う。
この経路は TS byte seek と reader を共有しないため、録画 TS のパケット境界補正の対象外。

### 注意点

- ストリームの有効化待ちには上限を設けている (ライブ 30 秒 / 録画 60 秒)。タイムアウト時は例外となり画質切替が失敗扱いになる (再生は継続)。
- 切替中は旧 video 要素が残るため、停止済みストリームへのセグメント要求で 404 が数回発生する (DPlayer が新しい video の `canplay` で旧要素を破棄するまでの間)。
- `BaseVideo` は画質切替ごとに `console.debug('[EPGStation][quality-switch]', phase, data)` を出す。`start` / `url-resolved` / `player-switch-requested` / `playback-ready` / `failed` で、旧 video の `connected`・`visible`・サイズ・`readyState`・再生位置と経過時間を確認できる。
- 字幕 (aribb24) と実況弾幕は DPlayer 側の `initVideo()` で再初期化されるため、切替後も表示設定が引き継がれる。

## 新4K8K衛星放送 (BS4K / CS4K) の配信

新4K8K衛星放送は MMT/TLV を dantto4k 等で MPEG-2 TS へ変換して受け取る (`doc/changelog-fork.md` 参照)。
配信経路そのものは従来の TS と同じだが、**映像が HEVC (H.265)・音声が MPEG-4 AAC** になる点が違う。

- **エンコードして配信する場合**: `encodePresets` の `qualities` に `2160p` を指定すると 4K のプリセットが生成される
  (映像 15000kbps / 音声 256kbps)。ビットレートは HEVC 前提なので `codecs: [hevc]` と併用する。
  H.264 を選んだ場合は 4K 用に `-level 5.2` が指定される
- **無変換 (mpegts / -c:v copy) で配信する場合**: 再生側の HEVC 対応に依存する
    - Safari は HLS + HEVC (`hvc1`) をネイティブ再生できる
    - Chrome / Firefox で mpegts.js の低遅延ライブを使う場合は HEVC 対応版が必要。確実に再生したいなら
      H.264 へエンコードするプリセットを使う
- 字幕は dantto4k が MMT の字幕を ARIB B24 の TS 字幕へ変換するため、in-memory HLS の `emsg` 経路
  (version 1 必須) を含め従来どおり動く
# ストリーミング実装メモ

## Phase 15: カスタムプリセット

設定画面の「カスタムプリセット」は既定で折り畳み、通常利用者向けの「再生」設定と分離している。Built-in の複製、基本項目、詳細項目、Raw Command を編集できる。保存は config.yml へ書き戻さず、`app_setting` の `config.stream.profiles` オーバーレイへ行う。

カスタムプロファイルは既存の `stream.profiles` に追加され、用途に応じて live / recorded.ts / recorded.encoded へ登録される。Raw Command は `StreamProfile.cmd` として保存され、`StreamProfileManageModel` の既存仕様により自動生成コマンドより優先される。既存の手書き cmd、Legacy 形式、録画後エンコード設定は変更しない。

## Playback API (Phase 7)

`GET /api/streams/live/{channelId}/playback-options` と `GET /api/videos/{videoFileId}/playback-options` は、入力映像と端末能力から利用可能なプロファイル、推奨プロファイル、再生方式、フォールバック列 (`recommended.fallbackChain`) を返す。端末能力は query (`hevc` / `hevcMain10` / `h264` / `hdr` / `hlg` / `network`) で渡す。自動選択時の列は、現在値より低負荷な全候補を解像度、品質区分、映像ビットレートの順に並べる。順序を保証できない旧 API 応答では、高品質側へ切り替わるのを防ぐため自動フォールバックを行わない。

`PlaybackPolicyResolver` は再エンコード不要な入力では `video-copy` / `direct-play` を優先する。HDR 非対応端末では SDR プロファイルへ自動選択し、`profiles` には実際に利用可能な候補だけを含める。

既存の `config.yml` の `stream.profiles.*` / 旧形式 `stream.live.*`・`stream.recorded.*` は、Built-in プリセットを導入してもユーザー定義を優先する。設定だけの環境では従来の mode 順と cmd を維持し、`encodePresets` 未設定時に新しい自動生成を強制しない。

## Command Builder (Phase 5)

`LiveCommandBuilder` / `RecordedCommandBuilder` は `SourceCapabilities`、`StreamPreset.output`、利用可能エンコーダ能力から配信 cmd を生成する。既存 `config.yml` の手書き `stream:` cmd と `StreamProfileManageModel` の生成経路は別系統として維持するが、cmd 省略時の H.264 出力は10bit入力を8bitへ明示変換する。

- デインターレースは搬送形式ではなく `source.scan` だけで決める。progressive は無指定、interlaced は field order (不明時 tff) と 30p/60p に従う
- source fps は解析値を rigaya の `--fps` へ渡す。未知値の 29.97 fallback は legacy-broadcast だけで、BS4K へ適用しない
- 10bit を維持する経路は Main10 / `--output-depth 10` または `yuv420p10le` を使う。H.264 (8bit) 出力へ変換する経路だけ `-pix_fmt yuv420p` (QSV/VAAPI は `format=nv12`) を明示し、対応しないエンコーダへは黙って切り替えず失敗する
- live は低遅延、recorded は品質寄り。ただし LL-HLS のため GOP は短く保つ
- エンコーダ能力の選択結果は 60 秒 TTL でキャッシュする

設計上、コンテナ / Transport と映像特性を混同しない。MPEG-TS でも BS4K 変換後は progressive として扱う。録画ファイルの fps を 29.97 に固定せず、HEVC Main10/HDR preserve は10bitを維持する。一方、H.264 (8bit) へ再エンコードする配信だけは `yuv420p` へ落とす。HDR→SDR は `format` だけで変換せず、トーンマップ・色域・メタデータを変換する。

## HDR / SDR トーンマッピング (Phase 6)

HDR (`hlg` / `pq`) を `tone-map` または `sdr` で配信するときだけ、ffmpeg は `zscale=t=linear:npl=100` → `tonemap=hable:desat=0` → BT.709 変換 → `format=yuv420p` の順で処理する。解像度 `scale` は色変換後に置き、出力メタデータも BT.709 にする。rigaya 系は `--vpp-colorspace hdr2sdr=hable` と BT.709 の color metadata を使う。

`preserve` は BT.2020 / HLG・PQ / 10bit を維持する。SDR 入力には HDR トーンマップを付けない。映像補正は `VideoCorrectionUtil` の純粋関数で決め、`auto` は解析に頼らず追加補正しない。ライブで輝度解析は行わない。

## データ放送の録画再生時刻

録画用のデータ放送 WebSocket は録画 TS を `decodeTS` へ先読みするため、WebSocket から届く `currentTime` は視聴者の再生位置ではない。録画再生では、メタデータ API の `startAt` (録画ファイル先頭の放送時刻) に DPlayer の動画全体の再生位置を加算し、BMLBrowser の `currentTime` をクライアントから 250 ms 間隔で更新する。timeupdate、play、pause、seeking、seeked でも即時更新する。ライブは TS の TDT/TOT を従来どおり使う。

停止中も更新を続けるのは、BMLBrowser が最後の currentTime と受信した PCR の差を補間するため。録画 TS の先読みで PCR が進んでも、再生位置の時刻を再注入して時計が実時間やエンコード位置へ進まないようにする。

## 録画実況のシーク同期

録画実況の表示時刻は、常に `videoFile.startAt + VirtualTimeline の絶対再生位置` で決める。時刻変換とコメント index の二分探索は `src/util/RecordedJikkyoSync.ts` に集約し、`JikkyoKakologClient` はこの経路だけを使う。過去ログは録画全体を取得したクライアントが DPlayer の再生成をまたいで保持するため、HLS のシーク・画質切替で再取得しない。

シーク開始時に録画実況の `danmaku.clear()` を呼び、シーク確定時に確定した絶対再生位置で index を貼り替えて同期する。確定通知は、通常シークの `setCurrentTime()`、録画 M2TS-LL / HLS のストリーム再生成完了、画質切替後の `canplay` から送る。再生成中の `dummyPlayPosition` は `null` として `tick()` / `sync()` から除外するため、ダミー位置への誤った貼り替えを防ぐ。一時停止中でも確定通知で1回同期する。

録画過去ログは遅延補正を使わない。`drawJikkyoCommentWithDelay()` はライブ実況だけが使い、録画は確定した VirtualTimeline 位置へ直接描画する。

## Phase 8/9 クライアント画質 UI

再生画質の表示は `PlaybackQualityList` / `PlaybackQualityItem` に集約した (旧 `PlaybackQualitySheet` は 2026-09-03 に削除。画質選択は配信選択ダイアログの中でインライン展開する方式へ一本化した)。画質リストは配信選択ダイアログと DPlayer の設定メニューの両方から共通のプロファイル一覧を参照する。`menu-card` と `menu-card-body`、safe area、`70svh` 上限、44px 行高を適用する。

`ClientCapabilityUtil` は MediaCapabilities の `decodingInfo()` を優先し、`canPlayType()` を補助に使う。HEVC Main10 は `hvc1.2.4.L153.B0`、HDR は `dynamic-range: high` で判定し、結果を localStorage に TTL 付きで保存する。回線状態はキャッシュせず、再生選択肢の取得ごとに Network Information API を読む。Save-Data または 3G 以下は `slow`、セルラーでも 4G・10Mbps 以上・RTT 200ms 以下なら `fast`、API 非対応なら `unknown` とする。回線情報は初期推奨の加減点にだけ使い、再生中の回線変化だけでは画質を変えない。**表示ラベルは `client/src/util/PlaybackLabelUtil.ts` の 1 か所で決める** (`getPlaybackLabel()` / `getPlaybackShortLabel()`)。**表示ラベルの引き当てキーは `PlaybackProfile.role`** (`auto` / `original` / `2160p-high` / `1080p-high` / `1080p` / `720p` / `data-saver`)。`profile.id` は `live-m2tsll-1080p-avc` のような実プリセット id なので、id で辞書を引くと `auto` 以外は必ず外れる (実際に一言説明とバッジが出ていなかった)。`role` はサーバが `PlaybackApiModel.builtinRole()` で決めて API に載せる。 **「おまかせ」プリセットを返すのはライブだけ**で、録画の配信では `profiles` に `auto` が入らない。`PlaybackOptionsState.getInitialPresetId()` は `auto` が無ければ `recommended.resolvedId` を初期選択にする (`auto` のままだと、一覧のどれも選択されていないのにボタンだけ「おまかせ」と出る)。 通常表示は「今回の選択」「何が嬉しいか」の一言 (summary) までとし、HEVC / Main10 / エンコーダ名やサーバ mode 番号などの技術的な詳細は `showDetail` (「詳しく表示」トグル、`IPlaybackOptionsState.preference.showQualityDetail` に永続化) が ON のときだけ出す。バッジ (`おすすめ` / `4K` / `HDR` / `変換なし` / `通信量小` / `カスタム`) の判定にはプリセット情報だけでなく `SourceCapabilities` (HDR 判定) も要るため、呼び出し側は `source` を渡す必要がある。

`PlaybackOptionsState` は Phase 7 の Playback API を端末能力付きで呼び、画質選択と設定を端末単位の localStorage へ保存する。Playback API の各 profile は preset id と container 別の既存 mode を持ち、VideoContainer は id を BaseVideo へ渡す。BaseVideo は container に対応する profile だけで DPlayer quality を作り、表示名・順序・件数を新 UI と一致させる。サーバーへ渡す mode は従来どおり config の添字であり、旧 config のみの環境では `StreamQualityUtil` の quality へフォールバックする。

画質切替前に BaseVideo が音量、muted、再生速度、字幕、Fullscreen、PiP を退避し、新しい video 要素の loadedmetadata / canplay 後に個別復元する。復元失敗は再生を止めない。

自動画質のプレイヤー起動エラーは VideoContainer が `recommended.fallbackChain` の全段を順に再試行する。再生エラーまたは切替 URL の生成失敗時だけ低負荷方向へ切り替える。停滞時は Resource Timing の実効帯域が揃えば複数段を飛ばし、揃わなければ1段ずつ進める。fallback 後のクールダウンは25秒とし、それでも停滞すればさらに低い段へ進む。`waiting` や回線状態の変化だけでは切り替えない。自動昇格は行わず、ユーザーが画質を手動選択した後は自動フォールバックを停止する。fallback 通知は warning snackbar を1回だけ表示し、「詳細」で直近のプレイヤーエラーを表示する。
