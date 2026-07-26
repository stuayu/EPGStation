export type SeriesBackfillState = 'idle' | 'running' | 'completed' | 'canceled' | 'failed';

/**
 * バックフィルの実行オプション
 */
export interface SeriesBackfillOption {
    // true の場合 DB を変更せずマッチ結果のプレビューのみ行う
    dryRun?: boolean;
    // 1 回に処理する録画件数 (省略時はデフォルト値)
    chunkSize?: number;
    // チャンク間の待機時間 (ms)。テスト等での調整用途 (省略時はデフォルト値)
    intervalMs?: number;
}

/**
 * ドライラン時の候補シリーズ (未確定候補の上位表示用)
 */
export interface SeriesBackfillPreviewCandidate {
    seriesId: number;
    seriesTitle: string;
    score: number;
}

/**
 * ドライラン時の 1 録画分のプレビュー結果
 */
export interface SeriesBackfillPreviewItem {
    recordedId: number;
    title: string;
    // true: 確定シリーズ (または新規作成予定) / false: 未確定 (候補のみ)
    matched: boolean;
    seriesId: number | null;
    seriesTitle: string | null;
    confidence: number | null;
    candidates: SeriesBackfillPreviewCandidate[];
}

/**
 * バックフィルの進捗状況
 */
export interface SeriesBackfillStatus {
    state: SeriesBackfillState;
    dryRun: boolean;
    // 対象総数 (処理済み + 残件数。処理が進むごとに更新される)
    total: number;
    processed: number;
    // シリーズへリンクされた (または新規シリーズが作成された) 件数
    linked: number;
    // 未確定キューへ積まれた件数
    pending: number;
    // manualLock 済み、またはタイトルが解決できず何もしなかった件数
    skipped: number;
    failed: number;
    startedAt: number | null;
    finishedAt: number | null;
    // 次回の再開位置 (この recordedId まで処理済み)
    lastRecordedId: number;
    error: string | null;
}

/**
 * バックフィルの進捗状況 (ドライラン時はプレビュー結果を含む)
 */
export interface SeriesBackfillResult extends SeriesBackfillStatus {
    previewItems?: SeriesBackfillPreviewItem[];
    // プレビュー件数が上限を超えて省略された場合 true
    previewTruncated?: boolean;
}

export default interface ISeriesBackfillManageModel {
    /**
     * 既存録画のシリーズ化バックフィルを開始する (既に実行中の場合は現在の状態を返すのみ)
     * 中断後の再実行は前回の続き (lastRecordedId) から再開する
     * @param option: SeriesBackfillOption
     * @return Promise<SeriesBackfillResult> 即座に返る現在の状態 (処理はバックグラウンドで継続する)
     */
    start(option?: SeriesBackfillOption): Promise<SeriesBackfillResult>;

    /**
     * 現在の進捗状況を取得する
     * @return Promise<SeriesBackfillResult>
     */
    getStatus(): Promise<SeriesBackfillResult>;

    /**
     * 実行中のバックフィルをキャンセルする (実行中でない場合は何もしない)
     */
    cancel(): Promise<void>;
}
