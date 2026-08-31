# ストリーミング再生基盤刷新 UI/UX 仕様書

`doc/streaming-revamp-spec.md` の Phase 8 / Phase 9 に対する詳細指示。
本書の指定は仕様書本体より優先する (UI/UX の最終決定はこちら)。

## 0. 現状 UI の問題点 (実測)

`client/src/components/onair/OnAirSelectStream.vue` /
`client/src/components/recorded/detail/RecordedDetailSelectStreamDialog.vue` は、

```text
[配信種別 ▼ M2TS-LL]  [設定名 ▼ 1080p HEVC QSVEncC]
```

という 2 段の `v-select` になっている。問題:

1. **「配信種別」は実装都合の概念**であり、利用者の関心 (画質・データ量・端末対応) と対応しない。
   M2TS / M2TS-LL / HLS / MP4 / WebM の違いを一般利用者が判断できない。
2. `mode` が**設定配列の添字**でしかなく、意味を持たない。設定を並べ替えると別画質になる。
3. 設定名に `HEVC` `QSVEncC` `QSV` 等の技術用語がそのまま出る。
4. 選べない組み合わせ (端末が HEVC 非対応など) も同じ見た目で並ぶ。
5. `client/src/util/StreamQualityUtil.ts` はサーバー config の名前をそのまま並べるだけで、
   **端末能力も入力の映像特性も一切見ていない**。

新 UI はこの 2 段構造を利用者から隠す。内部の `type` + `mode` は互換のため残す。

## 1. 情報設計

利用者に見せる軸は **1 つだけ**にする。

```text
画質 (= プリセット)
```

「配信種別」は画質プリセットが内部で持つ属性にする。
上級者向けに「詳細」を開いたときのみ、配信種別を明示的に選べるようにする。

### 3 階層

| 階層 | 対象 | 出す情報 |
| --- | --- | --- |
| L1 通常 | 全利用者 | `自動・おすすめ` / `オリジナル` / `4K 高画質` / `1080p 高画質` / `1080p 標準` / `720p` / `データ節約` |
| L2 詳細 | 少し詳しい人 | 映像補正 / HDR / 配信種別 / 音声トラック |
| L3 上級 | 設定画面のみ | カスタムプリセット / Raw Command |

L1 に L2 / L3 の項目を混ぜない。

## 2. 新規コンポーネント

| ファイル | 役割 |
| --- | --- |
| `client/src/components/video/quality/PlaybackQualitySheet.vue` | 再生開始ポップアップ (デスクトップ = `v-dialog`、モバイル = `v-bottom-sheet`) |
| `client/src/components/video/quality/PlaybackQualityList.vue` | 画質リスト本体 (上記とプレイヤー内メニューで共用) |
| `client/src/components/video/quality/PlaybackQualityItem.vue` | 1 行 (ラジオ + 名前 + 説明 + バッジ) |
| `client/src/components/video/quality/PlaybackOptionsMenu.vue` | 再生中の歯車メニュー (画質 / 映像補正 / HDR) |
| `client/src/model/state/video/PlaybackOptionsState.ts` + `IPlaybackOptionsState.ts` | 選択肢取得・決定・永続化。`ModelContainerSetter.ts` へ登録必須 |
| `client/src/util/ClientCapabilityUtil.ts` | 端末能力判定 (純粋寄り、TTL キャッシュ) |
| `client/src/util/PlaybackLabelUtil.ts` | プリセット → 表示文言 / バッジ / 説明文の変換 (純粋関数) |

`PlaybackQualityList.vue` を開始ポップアップとプレイヤー内メニューの両方で使い回すこと
(2 箇所に別実装を置くと必ずズレる)。

## 3. 表示文言

### プリセット行の構成

```text
● 自動・おすすめ                    [おすすめ]
  4K HDR・最高画質
  この端末は HEVC/HDR に対応しています
```

- 1 行目: プリセット名 (`StreamPreset.name`)
- 2 行目: 結果の要約 (`4K HDR・最高画質` / `1080p・標準画質` / `再エンコードなし`)
- 3 行目: 理由 (`auto` のときのみ。`PlaybackDecision.reason`)

3 行目は **`auto` を選んでいるときだけ**出す。全行に出すと圧迫する。

### 文言テーブル (通常表示 / 詳細表示)

| id | 通常表示 (1 行目) | 通常表示 (2 行目) | 詳細表示 |
| --- | --- | --- | --- |
| `auto` | 自動・おすすめ | (解決結果を動的に) | 解決した preset の detail |
| `original` | オリジナル | 再エンコードなし・最高画質 | `HEVC Main10 / 10bit / HLG` 等 |
| `2160p-high` | 4K 高画質 | 4K HDR・高画質 | `HEVC Main10 / 2160p / 59.94p / HLG` |
| `1080p-high` | 1080p 高画質 | フル HD・高画質 | `HEVC Main10 / 1080p / 59.94p / HLG` |
| `1080p` | 1080p 標準 | フル HD・標準画質 | `H.264 / 1080p / SDR` |
| `720p` | 720p | 通信量ひかえめ | `H.264 / 720p / SDR` |
| `data-saver` | データ節約 | 通信量最小 | `H.264 / 480p / SDR` |

**通常表示に `HEVC` `Main10` `QSVEncC` `BT.2020` を出さない。**
詳細表示は行を長押し / ホバー、または「詳細を表示」トグルで出す。

### バッジ

- `[おすすめ]` — `auto` に付ける。`appTheme` 色のチップ
- `[HDR]` — HDR 出力になるプリセット
- `[4K]` — 2160p 出力
- `[通信量大]` — モバイル回線 (`navigator.connection.type === 'cellular'` 等) 検出時、
  高ビットレートプリセットに付ける

バッジは 1 行に**最大 2 個**まで。3 個以上は狭い端末で折り返して行高が崩れる。

## 4. 再生開始ポップアップ

### 表示条件

**毎回出さない。** 出すのは以下だけ。

1. その端末で初回 (`localStorage` に決定履歴が無い)
2. 設定で「毎回選ぶ」を有効にしている
3. 前回選んだプリセットが今回の入力では使えない (例: 前回 `2160p-high`、今回 1080i 入力)

2 と 3 以外では `auto` の決定でそのまま再生を開始し、
プレイヤー内の通知 (`dp.notice`) で「自動・おすすめ (1080p 高画質) で再生しています」を
3 秒だけ出す。ここでタップすると画質メニューが開くこと。

### レイアウト

```text
┌──────────────────────────────┐
│ この番組を再生                        │
│ ニュース7                             │
├──────────────────────────────┤
│ ● 自動・おすすめ            [おすすめ] │
│   4K HDR・最高画質                    │
│   この端末は HEVC/HDR に対応しています │
│ ○ オリジナル                          │
│   再エンコードなし・最高画質           │
│ ○ 1080p 高画質                        │
│ ○ 720p                                │
│                          ▾ その他の画質 │
├──────────────────────────────┤
│ □ 次回から自動で再生                   │
│              [キャンセル]     [再生]   │
└──────────────────────────────┘
```

- 「その他の画質」の中に legacy プリセットと配信種別選択を畳む (既定は閉じる)
- 「次回から自動で再生」は既定 **ON**。一般利用者は 1 回で解放される
- 利用できないプリセットは**表示しない** (`disabled` で並べない)

## 5. モバイル

### 判定

```ts
this.$vuetify.display.smAndDown   // 600px 未満
```

**`UaUtil.isMobile()` を使わない** (UA 判定は分割表示・回転で当てにならない)。

### Bottom Sheet

`v-bottom-sheet` を使い、中央 Modal にしない。

```text
              ▁▁▁▁            ← ドラッグハンドル (幅 36px / 高さ 4px)
┌──────────────────────────────┐
│ 再生画質                              │
├──────────────────────────────┤
│ ● 自動           おすすめ / 1080p HDR │
│ ○ オリジナル                          │
│ ○ 1080p 高画質                        │
│ ○ 720p                                │
│ ○ データ節約                          │
├──────────────────────────────┤
│            [ 再生 ]                    │
└──────────────────────────────┘
     (safe-area-inset-bottom 分の余白)
```

### 必須要件

- **タップ領域は最低 44px** (`min-height: 44px` を各行へ。Vuetify の `v-list-item` の
  既定 density では足りないことがあるので明示する)
- **iOS Safe Area**:
  ```css
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
  ```
  左右にも `env(safe-area-inset-left/right)` を入れる (横画面のノッチ対策)
- **横画面対応**: シートの高さは `max-height: min(70svh, 480px)`。
  `vh` ではなく **`svh`** を使う (iOS Safari のアドレスバーで `vh` がずれる)。
  リスト部分だけ `overflow-y: auto` にし、ヘッダーとアクション行は縮ませない
  (`CLAUDE.md` の `.menu-card` / `.menu-card-body` と同じ流儀)
- **Player を完全に隠さない**: シートの高さ上限を画面の 70% までにする。
  ライブ視聴中は特に、選びながら映像が見えている必要がある
- **片手操作**: 主要アクション (「再生」) をシート最下部の親指の届く位置に置く。
  画面上部にプライマリボタンを置かない
- `v-bottom-sheet` の中身にも `.menu-card` 相当の
  `max-width: calc(100vw - 0px)` を効かせ、固定 `width` を書かない

### プレイヤー内メニュー (モバイル)

歯車をタップしたら**同じ Bottom Sheet** を出す (DPlayer の標準設定メニューは使わない)。
DPlayer の設定メニューは狭い端末で画面外へ出る。

## 6. デスクトップのプレイヤー内メニュー

歯車 → `PlaybackOptionsMenu.vue` (`v-menu` + `.menu-card`)。

```text
画質
  自動・おすすめ ✓
  オリジナル
  4K 高画質
  1080p 高画質
  1080p 標準
  720p
  データ節約
──────────────
映像補正
  自動 ✓
  オフ
  明るめ
──────────────
HDR                    ← HDR 入力のときだけ
  自動 ✓
  HDR を維持
  SDR に変換
```

- `v-menu` は**ビューポート幅に丸められない**。必ず `.menu-card` を付ける
- 本文に `.menu-card-body` を付けてスクロールさせる
  (`v-card` は先頭に `.v-card__loader` を挿むため「最初の子要素」では本文を指せない)
- 「HDR」セクションは `source.hdr !== 'sdr'` かつ端末が HDR 対応のときだけ出す
- 「4K 高画質」は `source.height >= 2160` のときだけ出す

## 7. 再生中の画質変更

既存の `client/src/components/video/BaseVideo.ts` の quality 切替機構
(`options.video.quality` + `resolveUrl(mode)` + `onSwitched(mode)`、`BaseVideo.ts:230-252`)
を**そのまま再利用する**。新しく別経路を作らない。

切替時に維持するもの:

```text
再生位置 / 字幕表示状態 / 音声トラック / 音量 / 再生速度 / Fullscreen / PiP
```

- 切替前に上記を退避 → 新 URL で再生開始 → 復元、の順で行う
- 表示は `dp.notice('720p に切り替えています…', -1)` 程度。**モーダルを出さない**
- 録画: 同じ再生位置 (`%SS%`) から再接続
- ライブ: ライブエッジへ追従 (HLS なら `synchronizeToLiveEdge()` 相当)
- 切替に失敗したら元のプリセットへ戻し、スナックバーで理由を出す

## 8. エラー時の表示

自動選択が起動失敗したときは fallback 後に**一度だけ**通知する。

```text
4K HDR で再生できなかったため、1080p で再生しています。   [詳細]
```

- `ISnackbarState.open()` を使う (`color: 'warning'`)
- 「詳細」で技術的なエラー理由 (エンコーダの stderr 要約など) を見られるようにする
- **無限リトライしない**。fallback の試行上限は 3 回

## 9. 設定画面

`client/src/views/Settings.vue` の表示タブに以下を追加する。

```text
再生
  既定の画質            [自動・おすすめ ▼]
  映像補正              [自動 ▼]
  HDR                   [自動 ▼]
  再生前に画質を選ぶ    [ OFF ]
  モバイル回線では画質を下げる  [ ON ]
```

- 各項目は端末ごと (`localStorage`)。ログイン機構が有効ならアカウント単位
- 説明は `hint` + `persistent-hint` へ書く。**ラベルに説明を書かない** (省略されて読めなくなる)
- `v-list-item-title` を項目名に使うなら `white-space: normal` を当てる

「カスタムプリセット」は**別セクション**に分け、既定で折り畳む。
一般利用者が誤って開いても圧倒されないよう、セクション冒頭に
「通常は変更する必要はありません」と 1 行入れる。

## 10. 検証 (必須・実測)

`playwright` の WebKit (iOS Safari と同じエンジン) で以下を実測する。
**スクリーンショットだけで判断しない** — 「画面外だが描画はされている」を見逃す。

| デバイス | サイズ |
| --- | --- |
| `devices['iPhone SE']` | 320x568 |
| `devices['iPhone 14 Pro']` | 393x660 |
| `devices['iPad Mini']` | — |

確認項目 (各デバイス × 縦横):

1. 再生開始シートの「再生」ボタンが `boundingBox()` でビューポート内に収まる
2. 実際に `click()` できる
3. 画質リストが 7 件あるときシート内でスクロールできる (画面外へ出ない)
4. プレイヤー内の歯車メニューを開いたとき、最下段の項目がビューポート内にある
5. 横画面 (landscape) でシートが画面の 70% を超えない
6. 設定画面の各行でラベル・選択値が省略されずに読める

結果は実際の `boundingBox()` の値付きで報告すること。
