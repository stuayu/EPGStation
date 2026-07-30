# ストリーミング刊新 (低遅延・iOS/Android 対応・iOS 26 対策)

本ドキュメントは 2026-07 のストリーミング周りの改修内容と運用方法をまとめたもの。

## 変更概要

### 1. mpegts.js 1.7.3 → 1.8.0 (ManagedMediaSource 対応)

- iOS / iPadOS Safari 17.1+ の **ManagedMediaSource (MMS)** に対応した mpegts.js 1.8.0 へ更新。
- これにより **iPhone / iPad の Safari でも M2TS-LL (低遅延) ライブ視聴が可能**になる (KonomiTV と同じ方式)。
- MMS は `video.disableRemotePlayback` が設定されていないと動作しないため、`DPlayerUtil.setupGlobals()` で `window.mpegts.createPlayer` をラップし、アタッチ前に `disableRemotePlayback` / `playsinline` を自動設定する。
- **適用には `cd client && npm i` が必要** (サンドボックス環境ではレジストリに到達できないため未適用。コードは 1.7.3 のままでも動作する後方互換設計)。

### 2. iOS 26 以降の既知不具合への対処 (`StreamSupportUtil`)

`client/src/util/StreamSupportUtil.ts` の `checkM2TSLLSupport()` に判定を集約:

| 環境                                  | M2TS-LL        | 備考                                                      |
| ------------------------------------- | -------------- | --------------------------------------------------------- |
| Chrome / Edge / Firefox               | ◯              | 従来通り MSE                                              |
| iOS / iPadOS Safari 17.1+ (タブ)      | ◯              | MMS 経由 (要 mpegts.js 1.8.0)                             |
| iOS / iPadOS 26+ のホーム画面 Web App | × → HLS へ誘導 | WebKit の不具合で再生開始不能 (KonomiTV でも 26.1 で報告) |
| macOS Safari 26+                      | × → HLS へ誘導 | mpegts.js ライブ再生で映像停止する既知不具合              |
| 古い iOS (17.1 未満)                  | × → HLS へ誘導 | MSE/MMS 非対応                                            |

- 判定結果は `ServerConfigModel` (配信形式の出し分け)、`OnAirSelectStream` (視聴ダイアログ)、`LiveMpegTsVideo` (プレイヤー)、`Settings` で共通利用。
- 非対応時は理由付きのエラーメッセージを表示し、ネイティブ HLS へ誘導する。

### 3. プレイヤー上からの解像度動的切替 (M2TS-LL)

- DPlayer の設定メニューに **画質 (quality) リスト**を表示し、再生を止めずに `config.yml` の `stream.live.ts.m2tsll` の各設定 (1080p / 720p / 480p など) を切り替え可能。
- サーバー側は接続単位でエンコードプロセスを起動するため、切替時は旧ストリームが自動終了し新モードで再接続される。
- ライブ HLS / 録画ストリーミングの切替は後述の「全配信方式での画質切替」で対応済み。

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
```

hls.js (`LiveHLSVideo`、Safari 以外):

```js
liveSyncDurationCount: 2,        // ライブエッジ同期距離を短縮
liveMaxLatencyDurationCount: 6,
backBufferLength: 30,            // メモリ増加対策
```

- Safari / iOS では自動再生ポリシーによる停止を避けるため、M2TS-LL でも自動再生を無効化し再生ボタン操作で開始するように変更。

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

## in-memory HLS（低遅延・ディスク書き込みなし）

ライブ HLS をディスクに書き出さず、メモリ上でセグメント化・配信するモードを追加した。

### 仕組み

- `config.yml` の `stream.live.ts.hls` の `cmd` が `%streamFileDir%` を含まない場合、in-memory モードと判定される（設定スキーマの変更なし・従来のディスク方式もそのまま動作）。
- in-memory モードの `cmd` は fragmented MP4 を標準出力（`pipe:1`）へ書き出すこと（`-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`）。
- サーバー側は `Fmp4Packager` で fMP4 を init セグメント / メディアセグメント（約 1 秒）に分解し、`HLSMemoryStoreModel`（singleton）に保持する。
- `/streamfiles/stream{id}.m3u8` などのリクエストはまずメモリストアから応答し、存在しない場合は従来どおりディスク（`streamFilePath`）へフォールバックする。
- tmpfs 等 OS 依存の仕組みを使わないため Windows でも動作する。
- **録画済み HLS 配信 (`RecordedHLS`) も同じ判定・同じ `HLSMemoryStoreModel` / `Fmp4Packager` / `/streamfiles/*` エンドポイントを共用して in-memory 化に対応済み** (`stream.recorded.{ts,encoded}.hls` の `cmd` が `%streamFileDir%` を含まなければ in-memory)。判定・パイプライン組み立ては `RecordedStreamBaseModel.isMemoryHLS()` / `startMemoryHLSPackaging()` に実装している (`LiveStreamBaseModel` と同名・同構造)。
  - 録画側はクライアントが再生位置 (`playPosition`) 付きでストリームセッションを作り直す方式 (シーク = ストリーム再生成) のため、ディスク方式の既存 cmd も `hls_list_size 0` + `delete_segments` のスライディングウィンドウであり、そもそも全編を保持する EVENT プレイリストではない。したがって in-memory 化してもシーク時の挙動 (再生位置からの作り直し) は変わらない。
  - in-memory モードでも ARIB 字幕に対応する (ライブと同じ仕組み)。`ts` 録画の場合、エンコード前の TS を `arib-subtitle-timedmetadater` へ通し、`AribId3Extractor` が ID3 timed metadata を抜き取り、`Fmp4Packager` がセグメント先頭の `emsg` box として再多重化する。エンコード済みファイル (`encoded`) には ARIB 字幕が含まれないため対象外。
  - メモリ保持・破棄・タイムアウト・`keep()` によるセッション延長は `StreamBaseModel` / `StreamManageModel` を共通で通るため、ライブ HLS と同じ経路でクリーンアップされる (ストリーム停止時に `HLSMemoryStoreModel.delete()` が呼ばれ、ゴミは残らない)。

### 低遅延化

- セグメント長 約1秒（`-g 30` + `frag_keyframe`）× プレイリストウィンドウ 6 で、従来（`hls_time 3` × 17）より大幅に遅延短縮。
- `-tune zerolatency` によりエンコーダ内部バッファ由来の遅延も削減。
- クライアントの hls.js は `liveSyncDurationCount: 2` のため、実測遅延は 2〜4 秒程度を想定（従来は 10 秒以上）。

### 制限事項

- in-memory モードの字幕は `emsg` box (`scheme_id_uri = https://aomedia.org/emsg/ID3`) で運ぶ。fMP4 には ARIB 字幕 ES / ID3 ES をそのまま多重化できないため、エンコード前の TS から ID3 timed metadata を抜き取り、セグメント先頭へ `emsg` として付け直す方式を採っている (`AribId3Extractor` → `Fmp4Packager.pushId3()`)。hls.js は `emsg` を ID3 として通知するため、クライアント側 (aribb24) の実装はディスク方式と共通。
- 上記の性質上、字幕の絶対時刻はエンコードパイプラインの遅延分 (おおむね 1 秒程度) だけずれることがある。フレーム単位の同期が必要な場合は従来のディスク方式 cmd を使用すること。
- 字幕を正しく扱うため、入力 TS は `tsreadex` を通すこと (ワンセグ/字幕の PID 整合やドロップ耐性のため実質必須)。cmd の先頭に `%TSREADEX% ... |` を置く形を推奨する。
- メモリ保持は直近 12 セグメント（約 12 秒）のみで、ストリーム停止時に即時解放される (ライブ・録画共通、`HLSMemoryStoreModel` の保持数は共通設定)。
- **PMT は 1 TS パケットに収まるとは限らない**。`arib-subtitle-timedmetadater` は PMT に metadata の記述子と ES を書き足すため、元の PMT が大きい放送局 (NHK 等) では 184 byte を超えて分割される。`AribId3Extractor` は PSI セクションを `section_length` まで組み立ててから解釈する。ここを先頭パケットだけで済ませると **metadata の PID を検出できず字幕が 1 つも出ない**。
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

`resetCurrentTime: true` を指定した場合 (録画系) は、DPlayer が行う「切替前の再生位置への seek」を抑止し、
新しいストリームの先頭から再生させる (ストリーム自体を再生位置から作り直しているため)。

### 注意点

- ストリームの有効化待ちには上限を設けている (ライブ 30 秒 / 録画 60 秒)。タイムアウト時は例外となり画質切替が失敗扱いになる (再生は継続)。
- 切替中は旧 video 要素が残るため、停止済みストリームへのセグメント要求で 404 が数回発生する (DPlayer が新しい video の `canplay` で旧要素を破棄するまでの間)。
- 字幕 (aribb24) と実況弾幕は DPlayer 側の `initVideo()` で再初期化されるため、切替後も表示設定が引き継がれる。
