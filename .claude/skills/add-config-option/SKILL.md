---
name: add-config-option
description: EPGStation に config.yml の設定項目を追加・変更する手順。型定義・既定値・スキーマ (GUI 編集可否)・両テンプレート・マニュアルまでを漏れなく揃えるために使う。
---

# 設定項目の追加手順

設定項目は **5 箇所** を揃えないと動かないか、テストで落ちる。
`src/model/config/ConfigSchema.ts` が**唯一の定義元**で、サーバの検証・API 応答・設定画面のフォームはすべてここから導出される。

**先に読む実例**: `ConfigSchema.ts` の `key: 'epgRealtime'` の項目 (複数フィールドを持つオブジェクト設定の手本)。

## 実効値の決まり方

```
既定値 (Configuration.DEFAULT_VALUE) → config.yml → DB オーバーレイ (画面からの変更)
```

画面で変更した値は `app_setting` の `config` キーに差分として入り、**yml へは書き戻さない**。

## 手順

### 1. 型定義: `src/model/IConfigFile.ts`

```ts
// 追加する項目
newFeature?: {
    enabled?: boolean;
    intervalMs?: number;
};
```

省略可能な項目は `?` を付け、**使う側で既定値を解決する**。

### 2. 既定値: `src/model/Configuration.ts` の `DEFAULT_VALUE`

既定値が要る項目はここに書く。値の丸め (下限・上限) が要るものは、専用の解決関数
(`src/model/epgUpdater/EPGRealtimeConfig.ts` のような形) を作って**そこに集約**する。
config はホットリロードされるので、**実行時に毎回読み直す**前提で書くこと。

### 3. スキーマ: `src/model/config/ConfigSchema.ts` (**必須**)

```ts
{
    key: 'newFeature',
    label: '新機能',
    hint: '何をする設定かを利用者向けの日本語で',
    requiresRestart: false,          // true なら画面に再起動が要る旨が出る
    editable: 'gui',                 // GUI で編集させない場合は 'ymlOnly' + reason
    fields: [
        { path: 'newFeature.enabled', label: '有効にする', type: 'boolean' },
        { path: 'newFeature.intervalMs', label: '実行間隔 (ms)', type: 'number', hint: '既定 500' },
    ],
},
```

- `editable: 'ymlOnly'` にする場合は **理由コード (`reason`) を必ず添える**
  (`selfReference` / `authLockout` / `shadowedByAppSetting` / `notYetWired`)
- パスワード・トークンは `secret: true` を付ける (画面と API 応答でマスクされる)

### 4. 両テンプレート: `config/config.yml.template` と `config/config-win.yml.template`

**両方に書く**。コメントアウトした例と既定値を添える形式で、既存の項目に合わせる。

> `test/ut/config-schema-template-sync.test.js` が**両テンプレートへの記載漏れを検知する**。片方だけだとテストが落ちる。

### 5. マニュアル: `doc/conf-manual.md`

項目の説明・既定値・設定例を追記する。

## 機能フラグにする場合

on/off だけなら `featureFlags` に足す方が簡単 (`src/model/FeatureFlags.ts` / `client/src/util/FeatureFlags.ts`)。

- **opt-out**。未指定は**有効**として扱う (`isFeatureEnabled` は `!== false` 判定)
- テストで「無効」を表すときは `featureFlags: {}` ではなく**該当キーに `false` を明示**する

## 完了チェックリスト

- [ ] `IConfigFile.ts` に型を追加した
- [ ] 既定値が要るなら `Configuration.ts` の `DEFAULT_VALUE` に追加した (丸めは解決関数へ集約)
- [ ] `ConfigSchema.ts` に追加した (`editable` / `requiresRestart` / `secret` を判断した)
- [ ] `config/config.yml.template` と `config/config-win.yml.template` の**両方**に書いた
- [ ] `doc/conf-manual.md` に説明を追記した
- [ ] 値の丸め・既定値の解決にテストを追加した
- [ ] `npm test` が通る (テンプレート同期テストを含む)

## 検証

```bash
npm run compile
npm test          # config-schema-template-sync.test.js が両テンプレートを検査する
```
