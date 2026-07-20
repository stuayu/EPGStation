---
name: db-migration
description: EPGStation の DB スキーマ変更 (エンティティ追加・カラム変更) とマイグレーション生成の手順。TypeORM で sqlite / mysql の両方に対応が必要。
---

# DB スキーマ変更手順

対応 DB は **sqlite と mysql のみ** (postgres のディレクトリは空で未対応)。マイグレーションは必ず両 DB 分を用意すること。

## 手順

1. **エンティティを変更する**: `src/db/entities/*.ts`
   - 既存エンティティ (Channel, Program, Recorded, Reserve, Rule など) のスタイルに合わせる

2. **コンパイルする**: マイグレーション生成は `dist/` の JS を参照するため、先に `npm run compile`

3. **マイグレーションを生成する** (mysql / sqlite の両方):

   ```bash
   npm run orm-gen --db=mysql --name=<変更内容を表すPascalCase名>
   npm run orm-gen --db=sqlite --name=<同じ名前>
   ```

   - 出力先: `src/db/migrations/{mysql,sqlite}/<timestamp>-<Name>.ts`
   - `ormconfig.js` が `config/config.yml` を読むため、対象 DB に接続できる状態が必要。接続できない場合は既存マイグレーションを参考に手書きする
   - 生成された SQL は必ず目視レビューする (TypeORM の自動生成は意図しない DROP を含むことがある)

4. **データアクセス層を更新する**: `src/model/db/I*DB.ts` / `*DB.ts`
   - DB 種別の差異 (LIKE / REGEXP / 大文字小文字 / boolean) は `DBOperator` の `getLikeStr` / `getRegexpStr` / `isEnableCS` / `convertBoolean` で吸収する。生 SQL に DB 依存構文を直接書かない
   - 新規 DB クラスを作った場合は `src/model/ModelContainerSetter.ts` に登録

5. **API に影響する場合**: `api.yml` と `api.d.ts` のスキーマも更新する

## 注意

- マイグレーションは起動時に自動実行される (`migrationsRun: true`)。手動適用は `npm run orm-run`
- 破壊的変更の前にはユーザーに `npm run backup` を案内する
- 検証: `npm run compile` が通ること + 生成 SQL のレビュー
