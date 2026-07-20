---
name: add-api-endpoint
description: EPGStation に新しい Web API エンドポイントを追加する手順。api.yml の定義からルートハンドラ・ビジネスロジック・DI 登録・共有型までの一連の作業に使う。
---

# API エンドポイント追加手順

express-openapi のファイルベースルーティングを採用しているため、以下の順で必ず全ステップを行うこと。1 つでも欠けるとルーティングされないかバリデーションエラーになる。

## 手順

1. **`api.yml` に仕様を定義する** (リポジトリルート)
   - `paths:` にエンドポイントを追加し、parameters / requestBody / responses と参照スキーマ (`components/schemas`) を定義する
   - ここに書かれていないパスは express-openapi がルーティングしない

2. **ルートハンドラを作成する**: `src/model/service/api/` 配下
   - **ディレクトリ構造 = URL パス**。例: `/api/reserves/{reserveId}` → `src/model/service/api/reserves/{reserveId}.ts`
   - `export const get/post/put/delete: Operation = async (req, res) => {...}` を定義し、`<operation>.apiDoc` に OpenAPI オペレーション定義を持たせる (既存ファイル `src/model/service/api/channels.ts` を参考にする)
   - レスポンスは `src/model/service/api.ts` の共通ヘルパー (`responseJSON`, `responseServerError` など) を使う
   - try/catch で囲み、エラー時は `api.responseServerError(res, err.message)`

3. **ビジネスロジック層を作成する**: `src/model/api/<機能名>/`
   - `IXxxApiModel.ts` (インターフェース) + `XxxApiModel.ts` (実装, `@injectable()`) のペアで作成
   - DB アクセスは `src/model/db/` の `I*DB`、Operator 側の操作は `src/model/ipc/IIPCClient` 経由で行う

4. **DI 登録**: `src/model/ModelContainerSetter.ts` に import と `container.bind<IXxxApiModel>('IXxxApiModel').to(XxxApiModel).inSingletonScope()` を追加

5. **共有型の更新**: リポジトリルートの `api.d.ts` にリクエスト/レスポンスの型を追加 (クライアントは `import * as apid from '.../api'` で参照する)

6. **クライアント側が必要なら**: `client/src/model/api/<機能名>/` に `IXxxApiModel` + `XxxApiModel` を作成し、`client/src/model/ModelContainerSetter.ts` に登録

## 検証

```bash
npm run compile        # サーバ型チェック
npm run lint
```

テストは存在しないため、可能なら実際にサーバを起動して curl 等でエンドポイントを叩いて確認する。
