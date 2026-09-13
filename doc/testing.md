# テスト方針

`node:test` ベース。テストは `dist/` の JS を `require()` するため、各 npm script が先に `npm run compile` を実行する。
テストコード自体は **JavaScript (`.test.js`)** で書く。

| レベル | コマンド | 置き場所 | 対象 |
| --- | --- | --- | --- |
| UT | `npm run test:ut` | `test/ut/` | 純粋ロジック。**行カバレッジ 80% がゲート** |
| ITA | `npm run test:ita` | `test/ita/` | 実 sqlite でのマイグレーション、複数モジュールの結合 |
| ITB | `npm run test:itb` | `test/itb/` | 外部 API 契約・通信系 (ローカルスタブサーバを使う) |

- `npm test` = UT + ITA。**コミット前に必ず通す**
- `npm run test:ci` = UT + ITA + ITB

## 手動・実機計測: playback harness

`tools/playback-harness/` に、実サーバと実録画ファイルを要求する再生計測ハーネスを置く。UT / ITA / ITB とは別レベル。`npm test` と CI へは含めない。

測定対象は、再生停止回数・最長停止、録画 m2tsll の前方 / 後方シーク、シーク後の `buffered` / `readyState` / 受信バイト、画質切替時間と DPlayer 要素二重化、`.dplayer-ptime`、実況コメント同期、HLS の ARIB 字幕 `emsg`、canvas 字幕描画、iPad/WebKit の音声候補、ManagedMediaSource 経路、録画連続・並列相当ストレス。

前提は稼働中の EPGStation、実在する `videoFileId` / `recordedId`、実録画ファイル。ハーネスはサーバを起動・停止せず、`config/config.yml` も変更しない。Playwright 系シナリオは任意依存の `playwright-core` と対象ブラウザが必要。依存を `package.json` へ追加しないため、CI の通常依存へ実機ブラウザを持ち込まない。HLS `emsg` の確認だけは `curl` + `ffprobe` で完結し、ブラウザ不要。

入口は次の1つ。`--help` はサーバ不要でシナリオ一覧を表示する。合否は終了コード `0` (PASS)、`1` (しきい値不合格)、`2` (引数・依存不足) で返す。

```sh
EPGSTATION_BASE_URL=http://<server-host>:8888 \
node tools/playback-harness/run.js --help

EPGSTATION_BASE_URL=http://<server-host>:8888 \
node tools/playback-harness/run.js watch \
  --video-file-id <video-file-id> --recorded-id <recorded-id> --duration 300

EPGSTATION_BASE_URL=http://<server-host>:8888 \
node tools/playback-harness/run.js m2ts-seek \
  --video-file-id <video-file-id> --recorded-id <recorded-id> \
  --streaming-type m2tsll --mode 0 --browser chromium
```

シナリオごとの目的・合否条件・しきい値は [`tools/playback-harness/README.md`](../tools/playback-harness/README.md) に記載。

## 規約

- 新機能は実装と同じコミットにテストを含める。新規モジュールを足したらテストも足す (足さないとカバレッジゲートで全体が落ちる)
- 不具合修正は、**先に再現するテストを書いてから**直す
- 外部サービスへは実アクセスしない。HTTP は `test/support/HttpStubServer.js` またはプロバイダ固有のスタブを使う
- DB マイグレーションを含む変更は、`test/ita` で **sqlite** の up / down を検証する (対応 DB は sqlite / mysql のみ)
- テスト名は「何が保証されるか」を日本語で書く

## DI クラスのテスト

DI クラスはコンストラクタ引数を**位置指定**で組み立てる (inversify のコンテナは使わない)。
`require('reflect-metadata')` を DI クラスの `require` より前に置くこと。

**依存を追加するときは引数を末尾に足す。** 途中に挿入すると、位置指定で組み立てている既存テストが
別の引数を別の役割で受け取り、静かに壊れる。

書き方の詳細は Skill `write-tests` (`.claude/skills/write-tests/SKILL.md`) にまとまっている。

## 機能フラグ

`featureFlags` は **opt-out** (未指定 = 有効)。テストで「無効」を表すときは `featureFlags: {}` ではなく、
該当キーに `false` を明示する。
