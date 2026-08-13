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
