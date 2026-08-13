---
name: add-client-page
description: EPGStation の Web UI (Vue 3 + Vuetify 4 + vue-facing-decorator) にページやコンポーネントを追加する手順。State クラス・API モデル・DI 登録・ルーティング・socket.io 購読の一連の作業に使う。
---

# クライアント画面追加手順

技術スタックは **Vue 3 + Vuetify 4 + `vue-facing-decorator` のクラスコンポーネント**。
状態管理は Vuex ではなく **inversify + State クラス** の独自パターン。既存の書き方から逸脱しないこと。

**先に読む実例**: `client/src/views/WatchHistory.vue` (ページ) と `client/src/model/state/storage/StorageState.ts` (State)。
迷ったらこの 2 つの書き方に合わせる。

## 手順

### 1. ページコンポーネント: `client/src/views/NewPage.vue`

```vue
<template>
    <v-main>
        <TitleBar title="画面名"></TitleBar>
        <v-container>
            <!-- 中身 -->
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import INewFeatureState from '@/model/state/newFeature/INewFeatureState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({ components: { TitleBar } })
class NewPage extends Vue {
    public isLoading: boolean = false;

    private newFeatureState: INewFeatureState = container.get<INewFeatureState>('INewFeatureState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public async created(): Promise<void> {
        await this.fetchData();
    }

    public async fetchData(): Promise<void> {
        this.isLoading = true;
        try {
            await this.newFeatureState.fetchData();
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '取得に失敗しました' });
            console.error(err);
        }
        this.isLoading = false;
    }
}

export default toNative(NewPage);
</script>
```

- **`export default toNative(ClassName)` を忘れない** (これが無いとコンポーネントとして解決されない)
- ライフサイクルは Vue 3 の名前。**`beforeDestroy` ではなく `beforeUnmount`**
- ルート遷移で再取得する画面は `@Watch('$route', { immediate: true, deep: true })` を使う (例: `client/src/views/Guide.vue`)

### 2. ルート登録: `client/src/router.ts`

import して `routes` 配列へ追加する。**router は hash モード** (`createWebHashHistory`)。URL は `/#/new-page` になる。

### 3. State クラス: `client/src/model/state/<機能名>/`

`INewFeatureState.ts` (インターフェース) + `NewFeatureState.ts` (`@injectable()`) のペア。

```ts
import { inject, injectable } from 'inversify';
import INewFeatureApiModel from '../../api/newFeature/INewFeatureApiModel';
import INewFeatureState, { NewFeatureItem } from './INewFeatureState';

@injectable()
export default class NewFeatureState implements INewFeatureState {
    private items: NewFeatureItem[] = [];

    constructor(@inject('INewFeatureApiModel') private apiModel: INewFeatureApiModel) {}

    /**
     * データを取得する
     */
    public async fetchData(): Promise<void> {
        this.items = (await this.apiModel.get()).items;
    }

    public getItems(): NewFeatureItem[] {
        return this.items;
    }
}
```

### 4. API モデル (サーバ通信がある場合): `client/src/model/api/<機能名>/`

`IXxxApiModel` + `XxxApiModel`。axios 共通層 `IRepositoryModel` を注入する。型はルートの `api.d.ts` (`import * as apid from '../../../../../api'`)。

### 5. DI 登録: `client/src/model/ModelContainerSetter.ts`

```ts
container.bind<INewFeatureState>('INewFeatureState').to(NewFeatureState).inSingletonScope();
container.bind<INewFeatureApiModel>('INewFeatureApiModel').to(NewFeatureApiModel).inSingletonScope();
```

**登録漏れは実行時エラー**になる (型チェックでは検出できない)。

### 6. ナビゲーション: `client/src/components/navigation/` にメニュー項目を追加

## リアルタイム更新 (socket.io)

```ts
private onUpdateStatusCallback = ((): void => {
    this.onUpdateStatus();          // ← メソッドを呼ぶだけにする
}).bind(this);

public created(): void {
    this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
}

public beforeUnmount(): void {
    this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
}

public onUpdateStatus(): void {
    // ここでは this が Vue インスタンスなのでデータを読んでよい
    if (this.targetId === null) return;
    void this.fetchData();
}
```

購読できるイベント: `onUpdateState` (全体) / `onUpdateEncodeState` / `onUpdateOnAirProgram` (EIT[p/f]、`{ channelIds }`) / `onUpdateProgram` (`{ channelIds, startAt, endAt }`)。
**登録したものは `beforeUnmount` で必ず解除する。**

## この画面まわりで実際に踏んだ落とし穴

- **クラスフィールドに書いたコールバックの `this` は Vue インスタンスではない**
  `vue-facing-decorator` はクラスフィールドの初期値を data 用の一時インスタンスから集めるため、
  `private cb = ((): void => { ... }).bind(this)` の `this` は一時インスタンスになる (**メソッドだけが Vue インスタンスへ束縛される**)。
  フィールドのコールバックから `this.watchParam` のようなデータを読むと**初期値しか見えず、条件判定が黙って壊れる**。
  → 判定・処理はメソッドに書き、フィールドのコールバックはそれを呼ぶだけにする。
- **番組表 (`Guide.vue`) のセルは手組み DOM**。データを取り直したら `GuideState.createProgramDoms()` と `Guide.renderProgramDoms()` の**両方**を呼ぶ。
- **`DataBroadcastingManager` など外部ライブラリのインスタンスは `markRaw()` で包む** (Vue のプロキシに入ると内部が壊れる)。
- 画面をまたぐ永続設定は `client/src/model/storage/` (localStorage) に置く。
- 機能フラグで出し分けるときは `isFeatureEnabled` (`@/util/FeatureFlags`)。**opt-out なので未指定は有効**。

## 完了チェックリスト

- [ ] `export default toNative(...)` を書いた
- [ ] `client/src/model/ModelContainerSetter.ts` に State / ApiModel を登録した
- [ ] socket.io を購読したなら `beforeUnmount` で解除した
- [ ] コールバックの中でデータを直接読んでいない (メソッド経由にした)
- [ ] エラー処理を `ISnackbarState.open({ color: 'error', ... })` + `console.error` で書いた
- [ ] `cd client && npm run build` が通る (vue-tsc の型チェック込み)

## 検証

```bash
cd client && npm run build   # 型チェック + ビルド。クライアントに lint は無い
```

画面の実挙動を確認する場合はサーバを起動し、`/#/<path>` を開く。
