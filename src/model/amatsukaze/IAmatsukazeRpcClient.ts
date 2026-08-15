/**
 * AmatsukazeServer との RPC で使う型定義。
 *
 * 値は Amatsukaze 本体 (nekopanda/Amatsukaze) の
 * AmatsukazeServer/Server/{ServerInterface,EncodeServerData}.cs に合わせてある。
 */

/**
 * RPC のメソッド ID (ServerInterface.cs の RPCMethodId)
 *
 * **メンバの並びは Amatsukaze のバージョンで変わる**。現行の Amatsukaze では
 * ChangeItem (103) より後ろにメソッドが 1 つ増えており、`Request` 以降が
 * nekopanda/Amatsukaze 当時の値から 1 ずつ後ろへずれている。
 * ID がずれたフレームを送るとサーバは応答を返さずソケットを切る (クライアント側は
 * `read ECONNRESET` になるだけで理由が分からない) ため、値を変えるときは
 * 実機の通信を観測して裏を取ること。
 *
 * 実測で確認済み: AddQueue = 102 / ChangeItem = 103 / Request = 112 /
 * 受信側 (200 番台) は据え置き
 */
export enum RPCMethodId {
    SetProfile = 100,
    SetAutoSelect = 101,
    AddQueue = 102,
    ChangeItem = 103,
    PauseEncode = 104,
    CancelAddQueue = 105,
    CancelSleep = 106,
    SetCommonData = 107,
    SetServiceSetting = 108,
    AddDrcsMap = 109,
    // 未検証 (EPGStation では使わない)。EndServer はサーバを止めてしまうため軽々に呼ばないこと
    EndServer = 111,
    Request = 112,
    RequestLogFile = 113,
    RequestLogoData = 114,
    RequestDrcsImages = 115,

    OnUIData = 200,
    OnConsoleUpdate = 201,
    OnEncodeState = 202,
    OnLogFile = 203,
    OnCommonData = 204,
    OnProfile = 205,
    OnAutoSelect = 206,
    OnServiceSetting = 207,
    OnLogoData = 208,
    OnDrcsData = 209,
    OnAddResult = 210,
    OnOperationResult = 211,

    AddTag = 300,
    SetOutDir = 301,
    SetPriority = 302,
    GetOutFiles = 303,
    CancelItem = 304,
}

/**
 * サーバへ要求する情報の種類 (ServerRequest)。
 * [Flags] enum だが、複数指定した際の表記に依存しないよう 1 つずつ送る
 */
export type ServerRequestName =
    'Setting' | 'Queue' | 'Log' | 'CheckLog' | 'Console' | 'State' | 'FreeSpace' | 'ServiceSetting';

/** キューアイテムの状態 (QueueState) */
export type AmatsukazeQueueState =
    | 'Queue' // キュー待ち
    | 'Encoding' // エンコード中
    | 'Complete' // 完了
    | 'Failed' // 失敗
    | 'PreFailed' // エンコード開始前に失敗
    | 'LogoPending' // ロゴ・プロファイル待ち
    | 'Canceled'; // キャンセル済み

/** キューアイテムの変更種別 (ChangeItemType) のうち使うもの */
export type AmatsukazeChangeItemType = 'Cancel' | 'RemoveItem' | 'ResetState' | 'Priority';

/** キューアイテム (QueueItem のうち EPGStation 側で使う項目) */
export interface AmatsukazeQueueItem {
    id: number;
    srcPath: string;
    dstPath: string | null;
    actualDstPath: string | null;
    state: AmatsukazeQueueState;
    priority: number;
    // 追加時刻 (unixtime ms)。解釈できない場合は null
    addTime: number | null;
    profileName: string | null;
    eventName: string | null;
    serviceName: string | null;
    failReason: string | null;
    consoleId: number;
    // エンコードにかかっている時間 (ms)。取得できない場合は null
    encodeTimeMs: number | null;
}

/** サーバ全体の状態 (State) */
export interface AmatsukazeServerState {
    pause: boolean;
    suspend: boolean;
    running: boolean;
    // 実行中タスクの進捗 (0〜1)
    progress: number;
}

/** コンソール (エンコーダ 1 本分) の出力 */
export interface AmatsukazeConsoleText {
    // エンコーダ番号 (QueueItem.consoleId と対応する)
    index: number;
    // 行単位のテキスト
    lines: string[];
}

/** サーバから届いた UIData のうち EPGStation 側で使う部分 */
export interface AmatsukazeUIData {
    // キュー全体 (差分更新のときは undefined)
    queueItems?: AmatsukazeQueueItem[];
    // 差分更新 (Add / Remove / Update / Move) で届いたアイテム
    updatedItem?: AmatsukazeQueueItem;
    // 差分更新の種別
    updateType?: 'Add' | 'Remove' | 'Update' | 'Clear' | 'Move';
    state?: AmatsukazeServerState;
    console?: AmatsukazeConsoleText;
}

export interface IAmatsukazeRpcClient {
    connect(): Promise<void>;
    close(): void;
    requestAll(): Promise<void>;
    changeItem(itemId: number, changeType: AmatsukazeChangeItemType): Promise<void>;
    on(event: 'uiData', listener: (data: AmatsukazeUIData) => void): void;
    on(event: 'consoleUpdate', listener: (data: AmatsukazeConsoleText) => void): void;
    on(event: 'close', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
}
