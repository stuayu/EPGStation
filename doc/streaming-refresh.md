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

| 環境 | M2TS-LL | 備考 |
| --- | --- | --- |
| Chrome / Edge / Firefox | ◯ | 従来通り MSE |
| iOS / iPadOS Safari 17.1+ (タブ) | ◯ | MMS 経由 (要 mpegts.js 1.8.0) |
| iOS / iPadOS 26+ のホーム画面 Web App | × → HLS へ誘導 | WebKit の不具合で再生開始不能 (KonomiTV でも 26.1 で報告) |
| macOS Safari 26+ | × → HLS へ誘導 | mpegts.js ライブ再生で映像停止する既知不具合 |
| 古い iOS (17.1 未満) | × → HLS へ誘導 | MSE/MMS 非対応 |

- 判定結果は `ServerConfigModel` (配信形式の出し分け)、`OnAirSelectStream` (視聴ダイアログ)、`LiveMpegTsVideo` (プレイヤー)、`Settings` で共通利用。
- 非対応時は理由付きのエラーメッセージを表示し、ネイティブ HLS へ誘導する。

### 3. プレイヤー上からの解像度動的切替 (M2TS-LL)

- DPlayer の設定メニューに **画質 (quality) リスト**を表示し、再生を止めずに `config.yml` の `stream.live.ts.m2tsll` の各設定 (1080p / 720p / 480p など) を切り替え可能。
- サーバー側は接続単位でエンコードプロセスを起動するため、切替時は旧ストリームが自動終了し新モードで再接続される。
- HLS / 録画ストリーミングの動的切替はサーバー側のセッション管理と絡むため、別途「配信基盤刊新」設計 (Notion の設計依頼書参照) で対応する。

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

- 解像度切替は M2TS-LL のみ。HLS / 録画再生の切替、配信形式 (M2TS-LL ⇄ HLS) のシームレス切替は今後の配信基盤刊新で対応。
- 解像度切替しても URL の `?mode=` クエリは更新されない (リロード時は当初のモードに戻る)。
- iOS 26 のホーム画面 Web App 制限は WebKit 側の修正で解除できる見込み。解除時は `StreamSupportUtil.checkM2TSLLSupport()` のバージョン判定を更新すること。

## in-memory HLS（低遅延・ディスク書き込みなし）

ライブ HLS をディスクに書き出さず、メモリ上でセグメント化・配信するモードを追加した。

### 仕組み

- `config.yml` の `stream.live.ts.hls` の `cmd` が `%streamFileDir%` を含まない場合、in-memory モードと判定される（設定スキーマの変更なし・従来のディスク方式もそのまま動作）。
- in-memory モードの `cmd` は fragmented MP4 を標準出力（`pipe:1`）へ書き出すこと（`-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1`）。
- サーバー側は `Fmp4Packager` で fMP4 を init セグメント / メディアセグメント（約 1 秒）に分解し、`HLSMemoryStoreModel`（singleton）に保持する。
- `/streamfiles/stream{id}.m3u8` などのリクエストはまずメモリストアから応答し、存在しない場合は従来どおりディスク（`streamFilePath`）へフォールバックする。
- tmpfs 等 OS 依存の仕組みを使わないため Windows でも動作する。

### 低遅延化

- セグメント長 約1秒（`-g 30` + `frag_keyframe`）× プレイリストウィンドウ 6 で、従来（`hls_time 3` × 17）より大幅に遅延短縮。
- `-tune zerolatency` によりエンコーダ内部バッファ由来の遅延も削減。
- クライアントの hls.js は `liveSyncDurationCount: 2` のため、実測遅延は 2〜4 秒程度を想定（従来は 10 秒以上）。

### 制限事項

- in-memory モードでは字幕（ARIB → ID3 timed metadata）非対応。字幕が必要な場合は従来のディスク方式 cmd を使用すること。
- 録画済み HLS 配信は EVENT プレイリストで全編を保持する必要があるため、従来どおりディスク方式のまま。
- メモリ保持は直近 12 セグメント（約 12 秒）のみで、ストリーム停止時に即時解放される。

### エンコードオプションのチューニング / HEVC / tsreadex

- H.264 は `-maxrate` + `-bufsize`（ビットレートの 2 倍）で VBV 制限をかけ、ライブ配信でのビットレートスパイクによるバッファリングを抑制。`-profile:v high` + `-level` 指定で圧縮効率を改善（1080p: 5000k / 720p: 3000k / 480p: 1500k）。
- HEVC (libx265) の例をコメントで同梱。`-tag:v hvc1` は Safari / iOS 再生に必須。`-x265-params scenecut=0:repeat-headers=1` で固定 GOP とセグメント単位のデコード開始を保証。ビットレートは H.264 の約半分。
- `cmd` に `|` を含む場合はシェル経由（Windows: cmd.exe / その他: /bin/sh）で実行されるため、`%TSREADEX% ... - | %FFMPEG% ...` のような tsreadex 前処理パイプラインが使える。`%TSREADEX%` は config の `tsreadex`（省略時は PATH 上の `tsreadex`）に置換される。
- シェル実行時の停止はシェルプロセスへの kill → パイプ閉じにより下流プロセスも連鎖終了する。
