---
name: add-api-endpoint
description: EPGStation に WebAPI エンドポイントを追加・変更する手順。api.yml の定義からルートハンドラ・ビジネスロジック・DI 登録・共有型・クライアント側までの一連の作業に使う。
---

# API エンドポイント追加手順

express-openapi の**ファイルベースルーティング**を使っている。
`api.yml` の定義とディレクトリ構造の両方がそろって初めてルーティングされるため、下の手順を 1 つも飛ばさないこと。

**先に読む実例**: `src/model/service/api/series/reanalyze.ts` (POST + エラー分岐) と
`src/model/api/series/SeriesMaintenanceApiModel.ts` (ビジネスロジック)。

## 手順

### 1. `api.yml` に仕様を定義する (リポジトリルート)

- `paths:` にエンドポイント、`components/schemas:` に参照スキーマを追加する
- **ここに書かれていないパスはルーティングされない**
- クエリの型は OpenAPI のスキーマに従って**自動変換される**。`type: integer` と書けば `req.query.mode` は数値で届く (文字列前提で書かない)

### 2. ルートハンドラ: `src/model/service/api/` 配下

**ディレクトリ構造 = URL パス**。`/api/series/reanalyze` → `src/model/service/api/series/reanalyze.ts`、
`/api/reserves/{reserveId}` → `src/model/service/api/reserves/{reserveId}.ts`。

```ts
import { Operation } from 'express-openapi';
import INewApiModel from '../../../api/newFeature/INewApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    try {
        const model = container.get<INewApiModel>('INewApiModel');
        api.responseJSON(res, 200, await model.doSomething(req.body));
    } catch (e) {
        const message = api.getErrorMessage(e);
        if (message === 'NewFeatureIsNotFound') {
            api.responseError(res, { code: 404, message });
        } else {
            api.responseServerError(res, message);
        }
    }
};

post.apiDoc = {
    summary: '日本語で 1 行',
    tags: ['newFeature'],
    description: '何をするか、副作用、非同期なら進捗の追い方まで書く',
    requestBody: { /* ... */ },
    responses: { /* ... */ },
};
```

- レスポンスは `src/model/service/api.ts` の共通ヘルパー (`responseJSON` / `responseError` / `responseServerError` / `getErrorMessage`) を使う
- **業務エラーは文字列コードで投げ、ハンドラ側で HTTP ステータスへ振り分ける** (上の例の `NewFeatureIsNotFound`)

### 3. ビジネスロジック: `src/model/api/<機能名>/`

`INewApiModel.ts` + `NewApiModel.ts` (`@injectable()`) のペア。express に依存させない。

- DB アクセスは `src/model/db/` の `I*DB` 経由
- **Operator 側の操作 (録画・予約・サムネイル等) は `IIPCClient` 経由**。Service プロセスから Operator のモデルを直接呼ばない (呼ぶとイベントが発火せず、socket.io 通知やサムネイル生成が動かない)

### 4. DI 登録: `src/model/ModelContainerSetter.ts`

```ts
container.bind<INewApiModel>('INewApiModel').to(NewApiModel).inSingletonScope();
```

### 5. 共有型: ルートの `api.d.ts`

リクエスト / レスポンスの型を追加する (サーバ・クライアント共通。`import * as apid from '.../api'` で参照)。

### 6. クライアント側 (必要なら)

`client/src/model/api/<機能名>/` に `IXxxApiModel` + `XxxApiModel` を作り、
`client/src/model/ModelContainerSetter.ts` に登録する。

## 認証・権限

`auth.enabled` が有効な環境では管理者限定の API がある (`/api/settings`・`/api/auth/users`・`/api/update`・`/api/logs`)。
同種の管理系 API を足すときは既存ハンドラの権限チェックの書き方に合わせる。

## 完了チェックリスト

- [ ] `api.yml` に `paths` と `components/schemas` を追加した
- [ ] ハンドラのファイルパスが URL パスと一致している
- [ ] `<operation>.apiDoc` を書いた (Swagger UI に出る)
- [ ] ビジネスロジックを `IXxx` + `Xxx` のペアで作った
- [ ] `ModelContainerSetter.ts` に登録した (**忘れると実行時に解決できず 500**)
- [ ] `api.d.ts` に型を追加した
- [ ] Operator 側の操作は IPC 経由にした
- [ ] テストを追加した (`npm run test:ut` は行カバレッジ 80% ゲートつき)

## 検証

```bash
npm run compile   # サーバ型チェック
npm run lint
npm test          # ut + ita
```

実際に叩いて確認する場合:

```bash
npm start
curl -s 'http://localhost:8888/api/<path>' | head
```

Swagger UI は `http://localhost:8888/api/debug`。
