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

- **セグメント長 = GOP 長**。fMP4 のフラグメント境界はキーフレーム (`frag_keyframe`) であり、`Fmp4Packager` は `partsPerSegment: 1` で 1 フラグメント = 1 セグメントにしているため、`-g` がそのままセグメント長になる。**遅延を詰めたいときはここを短くする**。QSV (`hevc_qsv`) 実運用で `-g 8` (≒0.27 秒、29.97fps) まで詰めても実測でエンコードが余裕を持って実時間に追いつくことを確認済み (後述の `-flags low_delay` 除去後)。より頻繁な I フレームは同一ビットレートでの実効画質をわずかに下げるトレードオフがある。
- **ライブ入力に `-re` を付けない**。`-re` は入力をリアルタイム速度に制限するオプションで、Mirakurun から流れてくる TS は元々リアルタイムなので二重の律速になり、遅延だけが増える (低遅延の m2ts-ll 側には元から付いていない)。代わりに `-fflags nobuffer` で ffmpeg 内部の入力バッファリングを抑える。
- プレイリストウィンドウは 8 セグメント、メモリ保持は 16 セグメント、再生開始は 2 セグメント貯まった時点 (秒数はセグメント長 = GOP 長に依存)。
- クライアントの hls.js は `lowLatencyMode: false` / `liveSyncDurationCount: 4` / `maxLiveSyncPlaybackRate: 1` で運用する。このサーバーは真の LL-HLS (`#EXT-X-PART`) を実装していないため `lowLatencyMode` を有効にする本来のメリットが無く、無効化しても `liveSyncDurationCount` によるライブエッジ追従は変わらず機能する (下記「調査の経緯」を参照。実際の不具合の原因ではなかったが、意味のない設定として無効化している)。
- **さらに詰めるなら EXT-X-PART (本来の LL-HLS)** が必要。`Fmp4Packager` は既にパート単位でデータを持っているため、`HLSMemoryStoreModel` に部分セグメントの配信とブロッキングなプレイリスト更新 (`_HLS_msn` / `_HLS_part`) を実装すれば 1 秒未満も狙える (未実装)。実装する場合は `lowLatencyMode: true` に戻した上で `#EXT-X-SERVER-CONTROL` / `#EXT-X-PART-INF` / `#EXT-X-PART` をプレイリストに含めること (含めないまま `lowLatencyMode: true` にすると hls.js の `LatencyController` が `timeupdate` のたびに再生速度を微調整する無意味な処理が走るだけになる)。

#### 実運用で発生した「ずっとかくつく」問題の調査経緯と真因

QSV (`hevc_qsv`) での低遅延ライブ HLS 配信で、視聴中ずっと映像がかくつく不具合が発生したことがある。原因調査は難航し、複数の誤った仮説を経て `-flags low_delay` に行き着いた。同種の問題が再発したときのために経緯を残す。

1. **サーバー側 (エンコード速度・セグメント結合) は終始健全だった**。ffmpeg のデバッグ出力 (frame=/speed=) を直接確認したところ、エンコードは常に実時間の 1.0x 強で安定しておりフレームドロップの増加もなし。`Fmp4Packager` が生成する連続セグメントの `tfdt`/`trun` をバイトレベルで解析しても、映像・音声トラックとも境界のタイムコードは完全に連続 (ギャップ・オーバーラップとも 0) だった。**「境目の結合ミス」という仮説は明確に否定された。**
2. **クライアント側の自動計測は複数の手法で食い違う結果になった**。`getVideoPlaybackQuality()` のドロップフレーム数はほぼ 0、Playwright でブラウザを録画して `ffmpeg freezedetect` (無変化 300ms 以上を検出) にかけても再生開始直後の数秒を除き異常なし。ところが `mpdecimate` (80〜200ms 程度の短い一時停止まで検出できる) にかけると多数のイベントが検出され、`requestVideoFrameCallback` で提示フレームのタイミングを直接計測すると、また別の頻度の異常が出た。
   - **この不一致の主因は測定手法自体の限界だった**: Playwright の画面録画は 25fps 固定なのに対し実際の映像は 29.97fps で、フレームレートの不一致がビート周波数のエイリアシングを生み再生とは無関係な「疑似フリーズ」を作り出していた。さらに検証対象がライブ放送だったため、テスト実行のたびに実際の映像内容 (動きの量) が変わってしまい、設定変更の効果と番組内容の違いを混同していた。
   - 結論: **ライブ放送を対象にしたブラウザ内自動計測は、この種の微妙な体感品質の変化を判定する手段として信頼できない。** 同種の切り分けが必要になった場合、録画済みファイル (内容が固定) を対象にするか、素直に人間が実際の画面を見て判断する方が早い。
3. **最終的に効いた変更は `-flags low_delay` の除去だった**。低遅延化の際に `-fflags nobuffer -flags low_delay` を追加していたが、これを `-fflags nobuffer` のみに戻す (`-flags low_delay` を外す) と、実際にユーザーが視聴して「安定した」と確認できた。`-flags low_delay` は ffmpeg の入力側でデコーダの内部バッファ/フレーム並べ替え遅延を無効化するオプションで、放送波の MPEG-2 (インターレース、B フレームを含みうる) との相性が悪く、データ自体は正しくても表示タイミングが不安定になっていたと考えられる。
4. **`-g 24` への変更 (QSV が 0.5 秒 GOP で「厳しい」という当初の申告) も誤診断だった可能性が高い**。`-flags low_delay` を外した状態で改めて `-g 15`→`-g 8` まで詰めても、エンコード速度は一貫して余裕を持って実時間を上回り、体感の不安定さも再発しなかった。当初 QSV の負荷が原因と判断された「かくつき」も、実際には同じ `-flags low_delay` 由来だった可能性が高い。
5. 教訓: **この手の「継続的な微妙な体感品質劣化」の切り分けでは、まずデータの正しさ (エンコード速度・セグメント連続性) を機械的に確認して安心してよいが、そこから先の「体感」の良し悪しは自動計測より実際のユーザーの目が最も信頼できる。** 変更は 1 つずつ行い、都度ユーザーに直接確認してもらうのが最短路だった。

### mpegts 配信 (m2ts / m2ts-ll) の ARIB 字幕

- **DPlayer は mpegts.js の `TIMED_ID3_METADATA_ARRIVED` からしか aribb24 へ字幕を渡さない**。TS に ARIB 字幕 ES (PID 0x130 等) がそのまま入っていても字幕は表示されない。そのため mpegts 配信でも HLS と同じく `arib-subtitle-timedmetadater` を通し、ID3 timed metadata ES (PID 0x1ffe) を足したうえでエンコーダへ渡す (`LiveStreamBaseModel`)
- **エンコード後も ID3 ES を残す必要がある**。m2ts-ll の自動生成コマンドは `-map 0 -c:s copy -c:d copy -ignore_unknown` を持つため ID3 ES が出力に残る (実測で `Data: timed_id3` が出力側にも存在することを確認済み)。`-map` を持たない従来の m2ts コマンドは映像・音声しか選択しないため、ID3 は出力されず字幕も出ない
- ID3 変換は PMT を書き換えるため、`-map 0` を使う設定では出力の PID 構成も変わる

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
