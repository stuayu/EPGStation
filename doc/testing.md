# テスト実行方針

新機能は実装と同じ PR にテストを含めます。機能フラグが `false` の場合は従来動作を維持します。

| レベル | コマンド                      | 用途                                                    |
| ------ | ----------------------------- | ------------------------------------------------------- |
| UT     | `npm run test:ut`             | 純粋ロジック。Node test coverage 80% をゲートにする     |
| ITA    | `npm run test:ita`            | API・DB・内部モジュール境界の結合                       |
| ITB    | `npm run test:itb`            | 外部 API 契約、IPC、DB 方言。実サービスには接続しない   |
| ST     | `npm run test:st`（導入予定） | Docker/Playwright によるシステム試験。各 Phase 末に実施 |

## テスト追加規約

- UT は `test/ut`、ITA は `test/ita`、ITB は `test/itb` に配置します。
- 外部 API は `test/support/HttpStubServer.js` またはプロバイダ固有スタブを利用し、CI から実サービスへアクセスしません。
- 不具合修正では、先に再現する UT または ITA を追加します。
- DB マイグレーションを含む PR は SQLite / MySQL / PostgreSQL の up/down を ITB で検証します。
- ST で発見した不具合は、可能な限り下位レベルの回帰テストへ還元します。
