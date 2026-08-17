# アーキテクチャ図

EPGStation が「どこに置かれ」「中で何が動き」「録画が生まれるまでに何が起きるか」を図でまとめたもの。
文章での説明は [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) にある。

- [1. 受信環境の全体像](#1-受信環境の全体像)
- [2. EPGStation のプロセス構成](#2-epgstation-のプロセス構成)
- [3. 録画が生まれるまで](#3-録画が生まれるまで)
- [4. 視聴 (ストリーミング) の経路](#4-視聴-ストリーミング-の経路)
- [5. EPG のリアルタイム追従](#5-epg-のリアルタイム追従)

## 1. 受信環境の全体像

EPGStation は**チューナーを直接触らない**。チューナーサーバ (Mirakurun / その互換実装) の
HTTP API 越しに TS ストリームと番組情報を受け取るだけで、チューナーの取り合いは
チューナーサーバ側で調停される。同じ API を使う視聴クライアントを並べて共存できるのはこのため。

```mermaid
flowchart TB
    subgraph HW["受信ハードウェア"]
        ANT["アンテナ<br/>地デジ / BS / CS"]
        TUNER["チューナー<br/>PX-W3PE / PLEX 等"]
        CARD["B-CAS / ACAS"]
    end

    subgraph DRV["ドライバ層"]
        BON["BonDriver (Windows)"]
        PX["px4_drv / recdvb (Linux)"]
    end

    subgraph TS["チューナーサーバ (Mirakurun 互換 API)"]
        MIRA["Mirakurun<br/>(本フォークは stuayu/Mirakurun 前提)"]
        RECISDB["recisdb-proxy<br/>BonDriver を共有し<br/>Mirakurun 互換 API を出す"]
        MIRAKC["mirakc"]
    end

    subgraph APP["視聴・録画アプリ (同じ API を使う)"]
        EPGS["EPGStation<br/>録画管理・予約・配信"]
        OTHER["KonomiTV / Komorebi など<br/>他の視聴クライアント"]
        EDCB["TVTest / EDCB<br/>(BonDriver 経由)"]
    end

    ANT --> TUNER
    CARD -.-> TUNER
    TUNER --> BON
    TUNER --> PX
    BON --> MIRA
    BON --> RECISDB
    PX --> MIRA
    PX --> MIRAKC
    RECISDB -. "BonDriver 共有" .-> EDCB

    MIRA --> EPGS
    RECISDB --> EPGS
    MIRAKC --> EPGS
    MIRA --> OTHER
    RECISDB --> OTHER

    EPGS --> BROWSER["ブラウザ / スマホ"]
    OTHER --> BROWSER
```

> [!NOTE]
> 本フォークは[フォーク版 Mirakurun (stuayu/Mirakurun)](https://github.com/stuayu/Mirakurun) との
> 組み合わせが前提。mirakc や互換実装でも起動はするが動作は保証しない。
> 互換実装を使う場合は `config.yml` の `tunerServerType` を明示すること
> (`/api/config/server` の応答で mirakurun / mirakc を自動判定しているため、
> 実装によっては誤判定して SSE を叩き続ける)。

## 2. EPGStation のプロセス構成

`dist/index.js` (Operator) を起動すると、Operator が Service を、さらに EPGUpdater を子として spawn する。
**録画に関わるものは Operator、Web に関わるものは Service** と覚えるとよい。

```mermaid
flowchart TB
    subgraph OP["Operator (親プロセス) — src/index.ts"]
        RSV["予約管理<br/>ReservationManageModel"]
        REC["録画実行<br/>RecordingManageModel"]
        THUMB["サムネイル生成"]
        SERIES["シリーズ判定<br/>SeriesResolver"]
        STORAGE["ストレージ監視"]
    end

    subgraph UPD["EPGUpdater (Operator の子)"]
        EPG["EPG 更新<br/>event stream 購読 + 定期実行"]
    end

    subgraph SV["Service (Operator の子) — ServiceExecutor.ts"]
        API["Web API (Express 5 + express-openapi)"]
        STREAM["ストリーミング配信"]
        ENC["エンコード管理"]
        SIO["socket.io 通知"]
        BML["データ放送 WebSocket"]
    end

    DB[("DB<br/>SQLite / MySQL")]
    TUNER["チューナーサーバ"]
    EXT["外部サービス<br/>しょぼいカレンダー / Annict / Wikidata<br/>ニコニコ実況 / GitHub Releases"]
    WEB["ブラウザ (Vue 3 + Vuetify 4)"]

    TUNER -- "TS ストリーム" --> REC
    TUNER -- "番組情報 / event stream" --> EPG
    TUNER -- "ライブ TS" --> STREAM

    EPG -- "process.send" --> OP
    OP <-- "IPC (src/model/ipc/)" --> SV

    RSV --> DB
    REC --> DB
    EPG --> DB
    SERIES --> DB
    API --> DB
    SERIES --> EXT
    WEB <-- "REST" --> API
    WEB <-- "socket.io" --> SIO
    WEB <-- "HLS / mpegts" --> STREAM
    WEB <-- "BML" --> BML
```

- Operator ⇔ Service は `src/model/ipc/` (`IPCServer` = 親、`IPCClient` = 子)
- **Service から Operator のモデルを直接呼ばない**。録画・予約・サムネイルの操作は必ず IPC 経由 (直接呼ぶとイベントが発火せず socket.io 通知やサムネイル生成が動かない)
- Service が落ちても Operator が再起動する。**Mirakurun 未接続でも起動する** (DB 接続だけは必須)

## 3. 録画が生まれるまで

```mermaid
sequenceDiagram
    participant M as チューナーサーバ
    participant U as EPGUpdater
    participant O as Operator
    participant R as Recorder
    participant A as 解析 (TS / ffprobe)
    participant S as SeriesResolver
    participant C as クライアント

    M->>U: event stream (番組の追加・更新・削除)
    U->>U: 緊急度を判定 (immediate / normal)
    U->>O: 番組更新を通知
    O->>O: ルールに一致する番組を予約化
    Note over O: 予約時刻になったら録画開始

    O->>M: program stream 要求 (programId 予約)
    M-->>R: programId は対象イベントが present になってから、時刻指定は予約時刻から TS が流れ始める
    R->>R: 録画開始ゲート (EIT[p/f] following/present と event_id を検証)
    R->>R: TS をファイルへ書き出し
    R->>O: 録画完了

    O->>A: TS 解析 (PAT/SDT/EIT/TDT) + ffprobe
    A->>A: 放送局・番組情報・映像音声情報を確定
    O->>S: シリーズ判定
    S->>S: 放送予定 → エイリアス → 作品辞書 → LLM → 類似度
    S-->>O: 作品・話数・サブタイトル・放送種別
    O->>C: socket.io で更新通知
```

判定の詳細 (順序・確度・辞書の使い分け) は [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md#シリーズ判定) を参照。

## 4. 視聴 (ストリーミング) の経路

ライブ HLS は **cmd に `%streamFileDir%` を含むかどうかで 2 モードに分かれる**。
どちらも ARIB 字幕に対応する。

```mermaid
flowchart LR
    TUNER["チューナーサーバ"] --> SM["StreamManageModel"]

    SM --> DIRECT["無変換<br/>(m2ts)"]
    SM --> LL["低遅延<br/>(m2tsll / mpegts.js)"]
    SM --> HLS{"ライブ HLS<br/>cmd に %streamFileDir% ?"}

    HLS -- "含まない" --> MEM["in-memory 配信<br/>Fmp4Packager → HLSMemoryStoreModel<br/>ディスク書き込みなし (Windows 対応)"]
    HLS -- "含む" --> DISK["TS セグメント方式<br/>ディスクへ書き出し"]

    MEM -- "字幕は emsg box (version 1 必須)" --> PLAYER
    DISK -- "字幕は ID3" --> PLAYER
    DIRECT --> PLAYER
    LL --> PLAYER["DPlayer<br/>hls.js / mpegts.js / aribb24.js"]

    PLAYER --> JIKKYO["実況コメント<br/>放送波の TDT/TOT で遅延補正"]
```

詳細と制限は [streaming-refresh.md](streaming-refresh.md) にある。

## 5. EPG のリアルタイム追従

災害時の特番割り込みや前番組の延長を、10 秒周期の tick や `epgUpdateIntervalTime` (既定 10 分) を
待たずに反映するための経路。

```mermaid
flowchart TB
    ES["event stream"] --> PRI{"ProgramUpdatePriority<br/>緊急度の判定"}
    PRI -- "immediate<br/>(番組の消滅・付け替え /<br/>放送時間未定 / 180 分以内に開始)" --> FLUSH["先行フラッシュ<br/>デバウンス 500ms"]
    PRI -- "normal" --> QUEUE["programQueue<br/>10 秒 tick で周期反映"]

    FLUSH --> SAVE["saveProgram()<br/>DB へ書き込み"]
    QUEUE --> SAVE

    SAVE --> ONAIR["ON_AIR_PROGRAM_UPDATED<br/>(EIT[p/f] 相当)"]
    SAVE --> RANGE["PROGRAM_RANGE_UPDATED<br/>(変更された時間帯 + 番組 id)"]

    ONAIR --> IPC1["IPC → Service → socket.io<br/>updateOnAirProgram"]
    ONAIR --> RSV1["updateOnAirReserves()<br/>現在〜15 分先の予約"]
    RANGE --> IPC2["IPC → Service → socket.io<br/>updateProgram"]
    RANGE --> RSV2["updateReservesByProgramIds()<br/>放送が何時間先でも追従"]

    IPC1 --> UI1["視聴画面 / 放映中一覧"]
    IPC2 --> UI2["番組表<br/>(表示中の時間帯と重なるときだけ取り直す)"]
    RSV1 --> RECD["RecorderModel<br/>録画中の時刻変更にも反映"]
    RSV2 --> RECD
```

通知が届いたかは Operator と Service の両方のログで追える
(`send onAirProgramUpdated to client: ...` / `notify updateOnAirProgram: ... clients: N`)。
