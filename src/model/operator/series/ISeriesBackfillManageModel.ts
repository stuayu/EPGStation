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
    // true の場合、前回の再開位置 (lastRecordedId) を破棄して先頭から実行し直す (dryRun 時は無視される)
    restart?: boolean;
    // true の場合、まだシリーズへリンクされていない録画だけを対象にする (ドライランでも有効)
    onlyUnlinked?: boolean;
    // 指定した場合、直近 (id の新しい方から) この件数の録画だけを対象にする。
    // 一時的な部分実行なので実バックフィルの再開カーソルには影響しない
    latest?: number;
}

/**
 * ドライラン時の候補シリーズ (未確定候補の上位表示用)
 */
export interface SeriesBackfillPreviewCandidate {
    // null はこのドライラン実行中に新規作成される予定のシリーズ (まだ DB に存在しない)
    seriesId: number | null;
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
    // 実行時に指定された絞り込み条件 (画面での確認用)
    onlyUnlinked?: boolean;
    latest?: number | null;
}

/**
 * シリーズ判定 1 ステップ分のトレース
 */
export interface SeriesAnalyzeStep {
    step: string;
    label: string;
    input: string;
    output: string;
    matched: boolean;
    detail?: string;
}

/**
 * 録画 1 件のシリーズ判定結果 (判定過程のトレース付き)
 */
export interface SeriesAnalyzeResult {
    recordedId: number;
    title: string;
    channelId: number;
    startAt: number;
    linked: boolean;
    pending: boolean;
    seriesId: number | null;
    seriesTitle: string | null;
    episodeNumber: number | null;
    episodeTitle: string | null;
    airType: string | null;
    matchMethod: string | null;
    confidence: number | null;
    manualLock: boolean;
    steps: SeriesAnalyzeStep[];
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

    /**
     * 録画 1 件だけシリーズ判定を実行し、判定過程のトレース付きで結果を返す
     * @param recordedId: number
     * @return Promise<SeriesAnalyzeResult>
     */
    analyze(recordedId: number): Promise<SeriesAnalyzeResult>;
}
