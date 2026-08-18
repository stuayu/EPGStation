---
name: write-tests
description: EPGStation のテストを追加する手順。node:test ベースで ut / ita / itb をどう使い分け、DI クラスをどうスタブするかに使う。新規モジュールを追加したときは必ず参照する。
---

# テスト追加手順

`node:test` ベース。**テストは `dist/` の JS を `require()` する** (各 npm script が先に `npm run compile` を実行する)。
TypeScript のテストランナーは無い。テストは **JavaScript (`.test.js`) で書く**。

## どこに書くか

| 種別 | 置き場所 | 対象 | コマンド |
| --- | --- | --- | --- |
| UT | `test/ut/*.test.js` | 純粋ロジック、判定関数、整形、設定の解決 | `npm run test:ut` |
| ITA | `test/ita/*.test.js` | 実 sqlite でのマイグレーション、複数モジュールの結合 | `npm run test:ita` |
| ITB | `test/itb/*.test.js` | 外部 HTTP を伴う通信系 (ローカルスタブサーバを使う) | `npm run test:itb` |

- `npm test` = ut + ita (**コミット前に必ず通す**)
- **`test:ut` は行カバレッジ 80% のゲート付き**。新規モジュールを足したらテストも足さないと全体が落ちる
- 外部サービスへ実アクセスしない。HTTP は `test/support/HttpStubServer.js` を使う

## 書き方 (UT)

```js
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyProgramEvent } = require('../../dist/model/epgUpdater/ProgramUpdatePriority');

const NOW = 1785225000000;
const MINUTE = 60 * 1000;

// テストデータを作るヘルパーは先頭にまとめる
const updateEvent = (id, startAt, duration) => ({
    resource: 'program',
    type: 'update',
    data: { id, startAt, duration, name: 'テスト番組' },
});

test('放送中の番組の更新は即時反映の対象になる', () => {
    assert.equal(classifyProgramEvent(updateEvent(1, NOW - 10 * MINUTE, 30 * MINUTE), { now: NOW }), 'immediate');
});
```

- **テスト名は日本語で「何が保証されるか」を書く** (既存テストの流儀)
- 時刻は固定値を使う。`Date.now()` に依存させない

## DI クラスのテスト

DI クラスは**コンストラクタ引数を位置指定で組み立てる**。inversify のコンテナは使わない。

```js
require('reflect-metadata');   // ← DI クラスを require する前に必要
const SomeManageModel = require('../../dist/model/operator/xxx/SomeManageModel').default;

const noopLogger = { system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} } };
const logger = { getLogger: () => noopLogger };

const model = new SomeManageModel(
    logger,
    { getConfig: () => ({}) },   // IConfiguration
    stubDB,                      // 必要な依存だけ実装したスタブ
);
```

> **依存を追加するときは引数を末尾に足す。**
> 途中に挿入すると位置指定で組み立てている既存テストが静かに壊れる (別の引数が別の役割で渡る)。
> 依存を足したら、そのクラスを組み立てているテストのスタブも必ず更新すること。

スタブは**そのテストが使うメソッドだけ**実装すればよい。DB のように状態を持つものは
`test/ita/series-backfill-idempotency.test.js` の `makeInMemorySeriesDB()` のように、
インメモリ実装をテストファイル内に書く。

## 非同期の待ち合わせ

固定の `sleep` ではなく条件待ちにする (CI のマシン差で不安定になるため)。

```js
const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) {
        if ((await predicate()) === true) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
};
```

## このプロジェクト固有の注意

- **機能フラグは opt-out**。「無効」を表すときは `featureFlags: {}` ではなく**該当キーに `false` を明示**する
- **`SeriesNormalizer` を変更したら** `test/ut/series-normalizer.test.js` と `test/ita/series-backfill-idempotency.test.js` を必ず通す (表記ゆれの意図をテストが固定している)
- **判定ロジックが 2 箇所にある場合は両方テストする** (例: `SeriesResolver.resolve()` とドライランの `SeriesBackfillManageModel.decide()`)
- 設定項目を追加したら `test/ut/config-schema-template-sync.test.js` が両テンプレートへの記載を検査する
- マイグレーションは `test/ita` で実 sqlite に対して up / down を検証する

## 完了チェックリスト

- [ ] 新規モジュールに対応するテストを追加した (カバレッジ 80% ゲート)
- [ ] 不具合修正なら**先に再現するテスト**を書いた
- [ ] DI クラスの依存を足したなら、組み立てているテストのスタブを更新した
- [ ] 外部サービスへ実アクセスしていない
- [ ] `npm test` が通る

## 検証

```bash
npm test          # ut + ita
npm run test:ci   # + itb (外部通信系を触ったとき)
```
