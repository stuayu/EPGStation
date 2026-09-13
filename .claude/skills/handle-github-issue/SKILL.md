---
name: handle-github-issue
description: stuayu/EPGStation に報告された Issue を調査・修正して報告するときに使う。再現の取り方、報告者環境との差の埋め方、コメントと close の作法。「Issue を見て」「Issue #N を直して」と言われたときに参照する。
---

# Issue 対応

`gh issue view <番号> --repo stuayu/EPGStation` で原文を読む。

## まず環境差を埋める

報告者の環境は手元と違う。**再現しないときは環境差を疑う**。EPGStation で効くのは主に次。

| 差分 | 影響 |
| --- | --- |
| `config.yml` の `tsreadex` の有無 | 音声トラックの選び方が変わる (`-dual_mono_mode` か `-map 0:a:1` か) |
| 配信プリセットが自動生成か手書き `cmd` か | 自動生成の修正は手書き cmd に効かない |
| 素材の codec (MPEG-2 / H.264 / HEVC tsreplace) | 字幕・音声の抽出経路が変わる |
| Mirakurun 本家か互換実装か | 返す値の形が違う (`null` / 空 `types` / `remoteControlKeyId` 無し) |
| OS (Windows / Linux) | パス・シェル・文字コード |
| ブラウザ (Safari / Chromium) と MSE / ManagedMediaSource | 再生経路そのものが変わる |

**報告に書かれていない項目は推測せず、コメントで尋ねる。**

## 再現できたら

原因を特定してから直す。切り分けは実測で行う (配信・再生なら `debug-playback` skill)。

**「たぶんこれだろう」で直して close しない。** 報告された症状が消えたことを測る。

## コメントの書き方

- **原因を具体的に書く** — 「修正しました」だけにしない。何がどう間違っていたか
- **実測値を添える** — 修正前後の数値
- **報告者の指摘が正しければそう書く** (`#33` は原因の指摘まで正確だった)
- **未確認は未確認と書く**。手元で再現できていない場合は、その旨と確認したい情報を書く

## close の判断

| 状況 | 対応 |
| --- | --- |
| 再現し、直し、実測で確認した | コメントして close |
| 直したが手元で再現できていない | **open のまま**。修正内容と再検証の依頼を書く |
| 環境差の可能性が残る | open のまま。確認したい項目を具体的に尋ねる |

`gh issue close <番号> --repo stuayu/EPGStation --reason completed`

## 注意

- **Issue へのコメント・close は指示役が行う**。委譲した実装エージェントにはさせない
  (勝手に close されると、未検証のまま閉じることになる)
- 複数の Issue が同じ原因のことがある。直したら**他の open issue にも効いていないか**確認する
