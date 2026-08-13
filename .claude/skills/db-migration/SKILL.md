---
name: db-migration
description: EPGStation の DB スキーマ変更 (エンティティ追加・カラム変更) とマイグレーション生成の手順。TypeORM で sqlite / mysql の両方に対応が必要。
---

# DB スキーマ変更手順

対応 DB は **sqlite と mysql のみ** (postgres のディレクトリは空で未対応)。
マイグレーションは**必ず両方**用意する。片方だけだともう一方の環境で起動できなくなる。

**先に読む実例**: 既存の `src/db/entities/VideoFileTsInfo.ts` と、対応する
`src/db/migrations/sqlite/` / `src/db/migrations/mysql/` の同名マイグレーション。

## 手順

### 1. エンティティを変更する: `src/db/entities/*.ts`

既存エンティティのスタイル (カラム定義・nullable の書き方・型) に合わせる。

### 2. コンパイルする

マイグレーション生成は `dist/` の JS を参照する。

```bash
npm run compile
```

### 3. マイグレーションを両 DB 分生成する

```bash
npm run orm-gen --db=mysql  --name=<変更内容のPascalCase名>
npm run orm-gen --db=sqlite --name=<同じ名前>
```

- 出力先: `src/db/migrations/{mysql,sqlite}/<timestamp>-<Name>.ts`
- `ormconfig.js` が `config/config.yml` を読むため、**対象 DB へ接続できる状態**が要る。接続できない環境では既存マイグレーションを参考に手書きする
- **生成された SQL は必ず目視レビューする**。TypeORM の自動生成は意図しない DROP / 再作成を含むことがある (特に sqlite はテーブル再作成方式)

### 4. データアクセス層: `src/model/db/I*DB.ts` / `*DB.ts`

- DB 種別の差異は `DBOperator` のヘルパー (`getLikeStr` / `getRegexpStr` / `isEnableCS` / `convertBoolean`) で吸収する。**生 SQL に DB 依存構文を直接書かない**
- **`delete()` に空の criteria を渡さない** (TypeORM 1.x は禁止)。全件削除は `createQueryBuilder().delete()`
- 大量の id を `IN` で引くときは 500 件ずつに分割する (既存の `ReserveDB.findProgramIds()` / `ProgramDB.findIds()` が手本)
- 新規 DB クラスを作ったら `src/model/ModelContainerSetter.ts` へ登録する

### 5. 影響範囲を直す

- API に出るなら `api.yml` + `api.d.ts`
- 既存データの移行が要るなら、マイグレーション内で `UPDATE` を書く (起動時に自動実行される)

## テスト

**マイグレーションのテストは実 sqlite で動く結合テスト (`test/ita`) に書く**。既存例:
`test/ita/` にある「migration creates and removes all tables」系のテスト。

- up → down → up が通ること (べき等性)
- 追加したカラムに既定値が入ること

```bash
npm run test:ita
```

## 完了チェックリスト

- [ ] エンティティを変更した
- [ ] `npm run compile` した上でマイグレーションを **mysql / sqlite 両方**生成した
- [ ] 生成 SQL を目視レビューした (意図しない DROP が無い)
- [ ] データアクセス層を更新し、DB 差異は `DBOperator` のヘルパーで吸収した
- [ ] 新規 DB クラスを `ModelContainerSetter.ts` に登録した
- [ ] `test/ita` にマイグレーションのテストを追加した
- [ ] API に影響するなら `api.yml` / `api.d.ts` も更新した

## 注意

- マイグレーションは**起動時に自動実行**される (`migrationsRun: true`)。手動適用は `npm run orm-run`
- 破壊的変更を伴う場合は、作業前にユーザーへ `npm run backup` を案内する
- 検証: `npm run compile` + `npm test` (ut + ita)
