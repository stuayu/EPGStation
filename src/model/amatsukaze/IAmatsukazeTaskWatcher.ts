import { AmatsukazeQueueState } from './IAmatsukazeRpcClient';

/** 監視対象タスクの現在の状態 */
export interface AmatsukazeTaskProgress {
    // 進捗 (0〜1)
    percent: number;
    // 画面に出す 1 行のログ
    log: string;
    state: AmatsukazeQueueState;
}

/** 監視対象タスクの終了結果 */
export interface AmatsukazeTaskResult {
    state: AmatsukazeQueueState;
    // 監視対象の入力ファイル (EPGStation から見たパス)
    sourcePath: string;
    // 成功したか (Complete のみ true)
    isSucceeded: boolean;
    // Amatsukaze が実際に出力したファイルのパス (EPGStation から見たパスへ変換済み)
    outputPath: string | null;
    /**
     * 出力ファイルパスのベース (拡張子なし。EPGStation から見たパスへ変換済み)。
     * Amatsukaze のバージョンによっては完了しても `ActualDstPath` が返らないため、
     * その場合はここから実ファイルを探す
     */
    outputPathBase: string | null;
    // 失敗理由 (Failed / PreFailed のとき)
    failReason: string | null;
    // エンコードにかかった時間 (ms)
    encodeTimeMs: number | null;
}

export interface IAmatsukazeTaskWatcher {
    start(): Promise<void>;
    markTaskAdded(): void;
    stop(): void;
    cancel(): Promise<void>;
    on(event: 'update', listener: (progress: AmatsukazeTaskProgress) => void): void;
    on(event: 'finish', listener: (result: AmatsukazeTaskResult) => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
}
