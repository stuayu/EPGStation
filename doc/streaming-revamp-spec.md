# ストリーミング再生基盤刷新 仕様書 (実装指示)

対象は **ライブ視聴** と **録画済みファイルのストリーミング視聴** のみ。
録画後エンコード (`config.encode[]` / `EncodeManageModel` / `EncodeFinishModel`) は**変更しない**。
録画処理・録画予約・サムネイル・EPG・録画開始時刻処理も**変更しない**。

## 0. 最重要原則

**コンテナ / Transport と映像特性を完全に分離する。**

以下の推測を全て禁止する。

- 「MPEG-TS だからインターレース」
- 「MPEG-TS だから yadif」
- 「録画 TS だから 29.97fps」
- 「HEVC だから Main 8bit」
- 「2160p だから BS4K」

BS4K は dantto4k 等で MMT/TLV → MPEG-TS へ変換済みでも、
`HEVC Main10 / 3840x2160 / 59.94p / 10bit / HLG / BT.2020` という映像特性を保持している。

現状コードで確認済みの違反箇所 (最低限ここは直す):

| 箇所 | 内容 |
| --- | --- |
| `src/util/EncodePresets.ts:166` | `FILE_INPUT_SYNC_OPTIONS = '--avsync forcecfr --fps 30000/1001'` を全ファイル入力へ適用 |
| `src/util/EncodePresets.ts:435-438` | `--interlace tff --vpp-deinterlace normal` / `--vpp-yadif` を無条件付与 |
| `src/util/EncodePresets.ts:270-280` | `buildVideoFilter()` の `deinterlace` が呼び出し側の ts/encoded 判定のみ由来。`format=nv12` 固定で 10bit を潰す |
| `src/model/stream/StreamProfileManageModel.ts:180-181` | `isEncodedSource ? null : 'yadif'` |

## 1. アーキテクチャ

```text
Source Analyzer ──▶ SourceCapabilities
                          │
Client Capabilities ──────┼──▶ Playback Policy Resolver ──▶ PlaybackDecision
Network / Device ─────────┘              │
                                         ▼
                              Stream Preset Registry
                                   │          │
                          Live Builder    Recorded Builder
                                   └────┬─────┘
                                        ▼
                                     Player
```

配置方針 (既存の命名規約に合わせる。DI 対象は `IXxx.ts` + `Xxx.ts` で
`src/model/ModelContainerSetter.ts` へ登録必須):

- `src/model/stream/capability/` — SourceAnalyzer / ClientCapabilities の型と解析
- `src/model/stream/preset/` — StreamPresetRegistry (Built-in + Legacy)
- `src/model/stream/resolver/` — PlaybackPolicyResolver
- `src/model/stream/builder/` — LiveCommandBuilder / RecordedCommandBuilder
- `src/util/` — 純粋関数 (フィルタ組み立て、トーンマップ引数生成など)

純粋関数へ切り出せるロジックは必ず `src/util/` の純粋関数にする (テスト容易性のため)。

## 2. 型定義 (Phase 2)

```ts
export type VideoTransport = 'mpegts' | 'mmt-tlv' | 'mp4' | 'other';
export type VideoCodecKind = 'mpeg2' | 'h264' | 'hevc' | 'av1' | 'unknown';
export type ScanType = 'interlaced' | 'progressive' | 'unknown';
export type ColorPrimaries = 'bt709' | 'bt2020' | 'unknown';
export type TransferKind = 'bt709' | 'hlg' | 'pq' | 'unknown';
export type HdrKind = 'sdr' | 'hlg' | 'pq' | 'unknown';
export type SourceClass = 'legacy-broadcast' | 'bs4k' | 'generic' | 'unknown';

export interface SourceCapabilities {
    transport?: VideoTransport;
    codec: VideoCodecKind;
    width?: number;
    height?: number;
    bitDepth?: 8 | 10 | 12;
    scan: ScanType;
    frameRate?: number;          // 59.94 等の実測値
    fieldOrder?: 'tff' | 'bff' | 'unknown';
    colorPrimaries?: ColorPrimaries;
    transfer?: TransferKind;
    hdr: HdrKind;
    sourceClass: SourceClass;
    // 解析の確からしさ。低いときは保守的な選択をする
    confidence: 'high' | 'medium' | 'low';
}

export interface ClientCapabilities {
    hevc: boolean;
    hevcMain10: boolean;
    h264: boolean;
    av1?: boolean;
    hdr: boolean;             // HDR 表示可能か
    hlg: boolean;
    screenWidth?: number;
    screenHeight?: number;
    hardwareDecode?: boolean;
    // 'wifi' | 'cellular' | 'unknown' 等
    network?: 'fast' | 'slow' | 'cellular' | 'unknown';
}

export interface StreamPreset {
    id: string;
    name: string;                                  // 日本語表示名
    description?: string;                          // 一般ユーザー向けの短い説明
    detail?: string;                               // 上級者向け (例: 'HEVC Main10 / 10bit / HLG')
    useFor: 'live' | 'recorded' | 'both';
    quality: 'original' | 'highest' | 'high' | 'balanced' | 'compact';
    // 通常 UI に出すか。legacy / custom は false
    builtin: boolean;
    legacy?: boolean;
    sourceConditions?: {
        sourceClass?: SourceClass[];
        hdr?: HdrKind[];
        minHeight?: number;
        maxHeight?: number;
    };
    clientConditions?: {
        requireHevc?: boolean;
        requireHevcMain10?: boolean;
        requireHdr?: boolean;
    };
    output: {
        codec?: 'copy' | 'h264' | 'hevc';
        resolution?: 'source' | '2160p' | '1080p' | '720p' | '480p' | '240p';
        bitDepth?: 'source' | 8 | 10;
        frameRate?: 'source' | '30p' | '60p';
        hdrMode?: 'preserve' | 'tone-map' | 'sdr';
        deinterlace?: 'auto' | 'off' | '30p' | '60p';
        videoBitrate?: number;   // kbps
        audioBitrate?: number;   // kbps
        container?: StreamContainer;
    };
}

export type VideoCorrectionMode = 'auto' | 'off' | 'bright';

export interface PlaybackDecision {
    presetId: string;
    label: string;
    reason: string;              // 「この端末は HEVC/HDR に対応しています」等、UI へそのまま出す一文
    mode: 'direct-play' | 'remux' | 'video-copy' | 'transcode';
    source: SourceCapabilities;
    output: StreamPreset['output'];
    correction: VideoCorrectionMode;
    fallbackChain: string[];     // 起動失敗時に順に試す presetId
}
```

型名は既存コードに馴染むよう調整してよいが、**概念と分離は必ず維持する**。

## 3. Source Analyzer (Phase 3)

### 録画ファイル

- `ffprobe` の stream 情報 (`codec_name` / `width` / `height` / `pix_fmt` /
  `field_order` / `avg_frame_rate` / `r_frame_rate` / `color_primaries` /
  `color_transfer` / `color_space`) を使う。
- 既存の `src/model/video/VideoFileAnalyzeModel.ts` と `video_file_ts_info`
  に解析済みの値があれば優先し、無ければ ffprobe を実行する。
- `pix_fmt` が `yuv420p10le` / `p010le` 等なら `bitDepth: 10`。
- `field_order` が `tt` / `bt` なら `interlaced` + `tff` / `bff`、
  `progressive` なら `progressive`、無ければ `unknown`。
- `color_transfer` が `arib-std-b67` なら `hdr: 'hlg'`、`smpte2084` なら `'pq'`。
- **`unknown` を `interlaced` の同義として扱わない。**

### ライブ

- 第一情報源はチャンネル種別 (`ChannelType`)。`BS4K` / `CS4K` は `sourceClass: 'bs4k'`。
- `GR` / `BS` / `CS` / `SKY` / `NW1`〜`NW40` は `legacy-broadcast`。
- 判定は `channelType` だけに固定せず、`networkId` レンジや
  実測メタデータで上書きできる余地を残す (将来の例外に備える)。
- ライブでは ffprobe を待てないため、**チャンネル種別からの推定値を初期値**とし、
  可能なら配信開始後に実測で補正できる構造にする (今回は初期値で可)。

### sourceClass ごとの既定値

| sourceClass | codec | 解像度 | scan | fps | bitDepth | hdr | primaries |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `legacy-broadcast` | mpeg2 | 1440x1080 / 1920x1080 | interlaced (tff) | 29.97i (59.94 fields) | 8 | sdr | bt709 |
| `bs4k` | hevc | 3840x2160 | **progressive** | **59.94** | **10** | **hlg** | **bt2020** |

`bs4k` は「2160p だから」ではなく **チャンネル種別 or 解析結果 (HEVC + Main10 + HLG/BT.2020)**
の複合で判定する。単独条件で断定しない。

## 4. Preset Registry (Phase 4)

### Built-in (通常 UI に出す)

| id | 表示名 | 内容 |
| --- | --- | --- |
| `auto` | 自動・おすすめ | Resolver が決定。既定 |
| `original` | オリジナル | direct-play / remux / video-copy を内部で使い分け |
| `2160p-high` | 4K 高画質 | HEVC Main10 / 10bit / source fps / HDR preserve |
| `1080p-high` | 1080p 高画質 | HEVC (可能なら Main10) / 1080p |
| `1080p` | 1080p 標準 | H.264 or HEVC / 1080p / SDR |
| `720p` | 720p | H.264 / 720p / SDR |
| `data-saver` | データ節約 | H.264 / 480p 相当 / 低ビットレート |

`2160p-high` は `sourceConditions.minHeight: 2160`。
HDR 選択肢は `source.hdr !== 'sdr'` のときだけ UI へ出す。
**利用できない選択肢を disabled で大量に並べない。非表示にする。**

### Legacy カタログ

旧 EPGStation および現 stuayu 版の設定を捨てない。以下を legacy プリセットとして登録する
(`builtin: false`, `legacy: true`。通常 UI では「その他の画質」配下に畳む)。

```text
EPGStation 無変換 (= original へマージ、名称は「オリジナル」)
EPGStation 720p / 480p
EPGStation HLS 720p / 480p
EPGStation MP4 720p / 480p
現 stuayu 版の 2160p / 1080p / 720p / 480p / 240p 各設定
```

### 既存 config との互換 (絶対条件)

- `config.yml` の `stream:` 以下 (`stream.profiles.live` /
  `stream.profiles.recorded.ts` / `stream.profiles.recorded.encoded` /
  旧形式の `stream.live.*` / `stream.recorded.*` の `cmd` 直書き)
  は**そのまま従来どおり動作する**こと。
- Built-in Preset が既存のユーザー設定を**上書きしてはならない**。
  ユーザー定義が存在する場合はそれを優先し、Built-in は追加候補として並ぶ。
- `encodePresets` による自動生成の既存挙動も壊さない。
- 移行に Feature Flag は使わない。

## 5. Command Builder (Phase 5)

`LiveCommandBuilder` / `RecordedCommandBuilder` を新設し、
`SourceCapabilities` + `StreamPreset.output` + エンコーダ能力から引数を組み立てる。

### deinterlace

```ts
// 禁止: const deinterlace = isTs;
```

必ず `source.scan` を基準にする。

- `scan === 'interlaced'` → deinterlace 有効。フィールドオーダは `source.fieldOrder`
  (不明なら tff)。`output.frameRate` が `60p` なら bob 系 (`--vpp-deinterlace bob` /
  `yadif=1`)、`30p` なら normal (`yadif=0`)。
- `scan === 'progressive'` → **deinterlace 引数を一切付けない**
  (`--interlace` / `--vpp-deinterlace` / `--vpp-yadif` / `yadif` /
  `deinterlace_vaapi` のいずれも付けない)。
- `scan === 'unknown'` → `deinterlace: 'auto'` は保守的に
  「sourceClass が `legacy-broadcast` なら有効、それ以外は無効」とする。

### フレームレート

- `output.frameRate === 'source'` → 解析済み `source.frameRate` を渡す。
  不明なら**引数を付けない** (エンコーダに任せる)。
- rigaya 系の誤検出対策は残すが、**固定 29.97 をやめる**。
  `--avsync forcecfr` は維持しつつ `--fps` には解析済み値を渡す
  (`59.94` → `--fps 60000/1001`、`29.97` → `--fps 30000/1001`)。
  `source.frameRate` が不明な場合のみ、`sourceClass === 'legacy-broadcast'` に限り
  従来の `30000/1001` を使う。BS4K には絶対に適用しない。
- 1080i を 60p 化する場合はフィールドレート (59.94) を出力 fps とする。

### bit depth / pixel format

- `output.bitDepth === 10` (または `'source'` かつ `source.bitDepth === 10`) のとき:
  - NVEncC / QSVEncC: `--profile main10 --output-depth 10`
  - libx265: `-profile:v main10 -pix_fmt yuv420p10le`
  - VAAPI / QSV(ffmpeg): `p010le` を使う
- **`format=nv12` を無条件に付けない。** 10bit 経路では `p010le` / `yuv420p10le`。
- **Main10 を要求しているのに 8bit しか出せないエンコーダへ黙って落とさない。**
  互換目的のプリセット (`720p` / `data-saver` 等) でのみ明示的に 8bit へ落とす。

### エンコーダ選択

`NVEncC → QSVEncC → VCEEncC → FFmpeg` の固定順にしない。
実際に利用可能なエンコーダと、要求 codec / bitDepth / HDR 対応可否から Resolver が選ぶ。
利用可否の検出結果はキャッシュする (TTL 付き)。

## 6. HDR / トーンマッピング / 映像補正 (Phase 6)

### 2 経路を明確に分ける

- **HDR Preserve**: `HLG / BT.2020 / 10bit` をそのまま維持。
  出力側にも `-color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc`
  (rigaya 系は `--colorprim bt2020 --transfer arib-std-b67 --colormatrix bt2020nc`)
  を明示し、HLS の `CODECS` / HDR メタデータも正しく出す。
- **SDR Compatibility**: トーンマッピングを通す。
  ffmpeg: `zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709,format=yuv420p`
  (`libplacebo` / `tonemap_opencl` が使えるならそちらを優先してよい)。
  rigaya 系: `--vpp-colorspace hdr2sdr=hable` 系を使う。
  **`format=yuv420p` へ落とすだけを「HDR→SDR」と呼ばない。**

### 映像補正 (UI 名称: 「映像補正」)

選択肢は `自動` (既定) / `オフ` / `明るめ` の 3 つだけ。

処理順序:

```text
HDR / Color メタデータ確認
        ↓
端末 HDR 対応判定
        ↓
HDR Preserve か SDR Tone Map か決定
        ↓
(必要なら) 輝度解析
        ↓
必要な場合だけ補正
```

- **固定 brightness フィルタの一律適用は禁止。**
- ネイティブ 4K/HDR コンテンツを勝手に明るくしない。
- 自信が持てない場合はトーンマッピング / メタデータ修正のみに留める (これが最も安全)。
- 輝度解析を行う場合は録画再生でのみ実施し (ffmpeg の `signalstats` 等を
  短時間サンプリング)、**ライブのリアルタイム性を阻害しない**。
  ライブでは解析を行わず、メタデータベースの判断のみとする。
- BS4K が暗く見える原因は「色温度」ではない。原因を
  `HLG を SDR として表示 / BT.2020↔BT.709 の扱い誤り / トーンマップ不足 /
  HDR メタ解釈不良 / 局側グレーディング / アップコン素材由来` に分けて扱う。

## 7. Playback API (Phase 7)

既存 API 構造に馴染む形で、Player が選択肢と推奨を取得できるエンドポイントを追加する。
`api.yml` を更新し、`api.d.ts` に型を追加すること (`add-api-endpoint` スキルの手順に従う)。

推奨:

```text
GET  /api/streams/live/{channelId}/playback-options
GET  /api/videos/{videoFileId}/playback-options
```

または Client Capability を渡す POST 形式。既存構造に合わせて自然な方を選ぶ。

レスポンス例:

```json
{
  "source": {
    "resolution": "2160p",
    "codec": "hevc",
    "bitDepth": 10,
    "fps": 59.94,
    "hdr": "hlg",
    "sourceClass": "bs4k"
  },
  "recommended": {
    "id": "auto",
    "resolvedId": "2160p-high",
    "label": "4K HDR・最高画質",
    "reason": "この端末は HEVC/HDR に対応しています"
  },
  "profiles": [
    { "id": "original", "label": "オリジナル", "detail": "HEVC Main10 / 10bit / HLG", "available": true },
    { "id": "2160p-high", "label": "4K 高画質", "detail": "...", "available": true }
  ],
  "options": {
    "hdr": ["auto", "preserve", "sdr"],
    "correction": ["auto", "off", "bright"]
  }
}
```

`profiles` には**その端末・その入力で実際に使える選択肢だけ**を入れる。

## 8. クライアント (Phase 8-9)

### Client Capability 判定

`client/src/util/ClientCapabilityUtil.ts` (新規) に純粋寄りの判定を置く。

- `MediaCapabilities.decodingInfo()` を第一に使う
  (`hvc1.2.4.L153.B0` で HEVC Main10 を、`hvc1.1.6.L93.B0` で Main を確認)
- `HTMLMediaElement.canPlayType()` を補助に
- `matchMedia('(dynamic-range: high)')` / `(video-dynamic-range: high)` で HDR 判定
- `window.screen` で解像度
- **UA だけで判定しない。iOS を H.264 固定にしない。**
- 判定結果は TTL 付きでキャッシュ (localStorage、TTL は 24 時間程度)。
  `hdr` / codec support / network は変わりうるので TTL を持たせる。

### プレイヤー UI (歯車メニュー)

```text
画質
  自動・おすすめ ✓
  オリジナル
  4K 高画質
  1080p 高画質
  1080p 標準
  720p
  データ節約

映像補正
  自動 ✓ / オフ / 明るめ

HDR                    ← HDR 入力のときだけ表示
  自動 ✓ / HDRを維持 / SDRに変換
```

4K 項目は 4K 入力のときだけ表示。利用できない項目は**非表示** (disabled 羅列にしない)。

### 再生開始ポップアップ

初回またはユーザー設定に応じてのみ表示。毎回強制表示しない。

```text
この番組を再生
● 自動・おすすめ   4K HDR / 高画質   この端末に最適です
○ オリジナル
○ 1080p 高画質
○ 720p
[再生]
□ 次回から自動で再生
```

**「なぜおすすめなのか」を短く表示する** (技術用語は出さない)。

### モバイル

- `$vuetify.display.smAndDown` で判定 (`UaUtil.isMobile()` に依存しない)
- 中央 Modal ではなく **Bottom Sheet** (`v-bottom-sheet`)
- タップ領域 44px 以上
- iOS Safe Area (`env(safe-area-inset-bottom)`) 対応
- 横画面対応、小画面でスクロール可能、Player を完全に隠しすぎない
- `CLAUDE.md` のスマホ・タブレット対応の節 (`.menu-card` / `.menu-card-body` /
  `.app-bar-title` / flex 指定など) の規約を全て守る

### 画質変更 (再生中)

変更しても以下を可能な限り維持する。

```text
再生位置 / 字幕 / 音声トラック / 音量 / 再生速度 / Fullscreen / PiP
```

- 録画: 同じ再生位置から再接続
- ライブ: 現在時刻へ自然に追従
- 表示は「720p に切り替えています…」程度

### 設定の保存

以下を端末ごとに保存する。ログイン機構が有効ならアカウント単位、匿名は localStorage。

```text
preferredQuality / videoCorrection / hdrMode /
autoPlayWithRecommendedQuality / mobileDataPreference
```

## 9. エラー処理 (Phase 10 前)

自動選択したプリセットが起動失敗したとき、`fallbackChain` に沿って順に試す。

```text
1. 同系統の軽量プリセット
2. SDR 版
3. H.264 互換
```

**無限リトライしない** (試行回数に上限を設ける)。
ユーザーへは「4K HDR で再生できなかったため、1080p で再生しています。」と表示し、
詳細でエラー理由を確認できるようにする。

## 10. テスト (Phase 10)

`test/ut` に純粋関数のテストを必ず追加する (`test:ut` に行カバレッジ 80% ゲートあり)。
テストは `dist/` を `require()` する点に注意。

必須ケース:

1. **Legacy 1080i MPEG-TS** (MPEG-2 / 1440x1080 / 29.97i / SDR)
   → deinterlace あり / 適切な 30p or 60p / BT.709
2. **BS4K converted MPEG-TS** (HEVC Main10 / 3840x2160 / 10bit / 59.94p / HLG / BT.2020)
   → BS4K 判定 / **deinterlace なし** / **29.97 固定なし** / Main10 維持 / 10bit 維持 / HLG 維持
3. **BS4K 1080p HDR** → 2160p→1080p / Main10 / 10bit / 59.94p / HLG
4. **BS4K SDR compatibility** → HLG→SDR トーンマップ / BT.2020→BT.709
5. **Original** → 再エンコード不要端末で video copy になること
6. **iOS HDR capable** → HEVC Main10/HDR プロファイルが選択可能
7. **iOS HDR incapable** → SDR プロファイルへ自動 fallback
8. **既存 config 互換** → `stream:` 設定だけの環境で従来と同じプリセットが使えること
9. **録画再生のシーク** → 画質変更後も元の再生位置を保持
10. **ライブの画質切替** → ライブ位置へ正常復帰

生成されるコマンド文字列をスナップショット的に検証するテストを書くこと
(「BS4K に `--interlace` / `yadif` / `30000/1001` が含まれないこと」を明示的に assert する)。

## 11. 判断基準の優先順位

```text
1. 正しい映像処理
2. 既存設定との互換性
3. 利用者が理解しやすい UI
4. 自動選択の精度
5. 高画質
6. 低遅延
7. 高度なカスタマイズ性
```

ライブではリアルタイム性も重要。

## 12. Live と Recorded のチューニング差

| | Live | Recorded Playback |
| --- | --- | --- |
| 優先 | リアルタイム性 → 低遅延 → 安定性 → 画質 | 画質 → 安定性 → 圧縮効率 → 速度 |
| GOP | 短い | 短い (LL-HLS のパート境界) |
| preset | 速度寄り | 品質寄り |
| lookahead / B-frame / AQ | 控えめ | 使用可 |

画面上の名称が同じでも内部チューニングを分ける。録画後エンコードとは無関係。

## 13. 上級者向け設定 (Feature Flag 不要。UI の階層化で解決)

設定画面に「カスタムプリセット」セクションを置く。

- Built-in を「複製してカスタマイズ」できる
- 基本項目: 名前 / 用途 (ライブ・録画再生・両方) / 解像度 / Codec / Bit Depth /
  FPS / HDR / 映像補正 / エンコーダ / 品質
- 「さらに詳細」: Profile / Level / Rate Control / Bitrate / Max Bitrate /
  CRF・QVBR・CQP / GOP / B Frames / Lookahead / AQ / Deinterlace / Pixel Format /
  Color Primaries / Transfer / Tone Mapping / 追加引数
- 最終手段として Raw Command も使える

**通常ユーザーへ NVEncC / Main10 / QVBR / AQ / BT.2020 等を理解させない。**
通常表示は「4K HDR・最高画質」、詳細表示でのみ「HEVC Main10 / 10bit / HLG」。

## 14. Raw MMT/TLV (今回は構造だけ)

`Mirakurun decode=0 → MMT/TLV → FFmpeg libaribtlv` または raw passthrough の
経路を将来足せるよう `transport: 'mmt-tlv'` を型に持たせ、分岐点を用意しておく。
この経路では tsreadex を通さない。今回は MPEG-TS 変換済み BS4K を正しく扱うことを優先。

## 15. HonomiTV から取り込む考え方 / 取り込まないもの

参考: https://github.com/makeding/HonomiTV

取り込む:

- BS4K を通常放送と分離
- BS4K progressive を deinterlace しない
- BS4K を 60p として扱う
- MMT/TLV 時の tsreadex バイパス / raw MMTS path / libaribtlv 入力
- HEVC 10bit を「画質名」から分離
- `--output-depth 10`
- 端末 / 画質によるオプション解決
- KonomiTV 型の分かりやすい画質選択 UI

取り込まない:

- HEVC 10bit なのに `profile main`
- 4K を 1080p へ制限する仕様
- Main10 保存時の `fallback-bitdepth`
- KonomiTV 固有のビットレート値
- EPGStation の自由度を失う固定プリセット方式

## 16. ドキュメント更新 (必須)

実装完了 = ドキュメント更新完了。

- `doc/changelog-fork.md` に変更を追記
- アーキテクチャ・注意点が変わるなら `doc/PROJECT_OVERVIEW.md` も更新
- `doc/streaming-refresh.md` を更新
- API 追加時は `api.yml` + `api.d.ts`
- 設定項目追加時は `doc/conf-manual.md` + `config/config.yml.template` +
  `config/config-win.yml.template` (`test/ut/config-schema-template-sync.test.js` が検知)

## 17. 完了報告に必ず含める項目

1. 変更したファイル一覧
2. 新しいアーキテクチャ概要
3. BS4K 判定方法
4. Main10 / 10bit 処理
5. HLG / HDR 処理
6. 映像補正処理
7. Live と Recorded の違い
8. Built-in プリセット一覧
9. Legacy 互換方法
10. iOS / Safari 対応方法
11. モバイル UI 対応
12. 実行したテスト (実際のコマンドと結果)
13. 未解決事項
14. 将来改善候補

**コンパイルが通るだけで完了扱いにしない。**
特に `BS4K HEVC Main10 2160p59.94 HLG MPEG-TS` を通常の 1080i MPEG-TS と
誤認しないことを、テストで明示的に確認すること。
