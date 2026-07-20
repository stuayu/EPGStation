---
name: add-client-page
description: EPGStation の Web UI (Vue 2.7 + Vuetify 2) に新しいページやコンポーネントを追加する手順。State クラス・API モデル・DI 登録・ルーティングの一連の作業に使う。
---

# クライアント画面追加手順

クライアントは Vue 2.7 (クラスコンポーネント + `vue-property-decorator`) + Vuetify 2。状態管理は Vuex ではなく **inversify + State クラス** の独自パターン。既存の書き方から逸脱しないこと。

## 新規ページ追加

1. **ページコンポーネント**: `client/src/views/NewPage.vue`
   - `@Component({ components: {...} })` + `class NewPage extends Vue` のクラスコンポーネント形式
   - ナビゲーションガードを使う場合は `Component.registerHooks([...])` を先に呼ぶ (例: `client/src/views/Dashboard.vue`)

2. **ルート登録**: `client/src/router.ts` に import + `routes` 配列へエントリ追加

3. **State クラス** (画面状態・ロジック): `client/src/model/state/<機能名>/INewFeatureState.ts` + `NewFeatureState.ts` (`@injectable()`)
   - コンポーネントからは `container.get<INewFeatureState>('INewFeatureState')` で取得しプロパティに保持

4. **API モデル** (サーバ通信が必要なら): `client/src/model/api/<機能名>/` に `IXxxApiModel` + `XxxApiModel`
   - axios 共通層 `IRepositoryModel` を注入して使う。型はルートの `api.d.ts` (`import * as apid`)

5. **DI 登録**: `client/src/model/ModelContainerSetter.ts` に State / ApiModel を bind 追加 (**忘れると実行時エラー**)

6. **ナビゲーション**: `client/src/components/navigation/` 配下にメニューリンクを追加

## リアルタイム更新が必要な場合

`created()` で `ISocketIOModel` の `onUpdateState`、`beforeDestroy()` で `offUpdateState` を登録し、コールバックで State を再フェッチする (例: Dashboard 関連の State)。

## 規約

- エラー処理: try/catch → `ISnackbarState.open({ color: 'error', text: ... })` + `console.error`
- 画面をまたぐ永続設定は `client/src/model/storage/` (localStorage) に置く
- 検証: `cd client && npm run build` が通ること (`--openssl-legacy-provider` は script に組み込み済み)
