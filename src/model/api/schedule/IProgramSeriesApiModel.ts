export interface ProgramSeriesResult {
    programId: number;
    seriesId: number;
    episodeId: number | null;
    confidence: number;
    source: string;
}
export interface ProgramSeriesPrecomputeResult {
    processed: number;
    matched: number;
    pending: number;
    skipped: number;
}
export interface ProgramSeriesMetrics {
    // 直近の precompute バッチにおける未マッチ番組率 (0〜1)
    unmatchedRate: number;
    // confidence 分布 (0.0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0 の 5 バケット)
    confidenceHistogram: number[];
    totalPrograms: number;
    matchedPrograms: number;
    updatedAt: number | null;
}
export default interface IProgramSeriesApiModel {
    /**
     * 番組 ⇄ シリーズの対応を取得する (参照のみ。DB への書き込みは行わない)
     * @param programId number
     * @return ProgramSeriesResult | null 事前マッピングバッチ (§4.10) 未実行、または未マッチの場合は null
     */
    get(programId: number): Promise<ProgramSeriesResult | null>;

    /**
     * EPG 更新時に番組 ⇄ シリーズの対応を事前計算し DB へ保存する (§4.10 事前マッピングキャッシュ)。
     * SeriesResolver と同じしきい値判定を用い、しきい値未満は確定させず記録しない
     * @param programIds number[]
     * @return ProgramSeriesPrecomputeResult
     */
    precompute(programIds: number[]): Promise<ProgramSeriesPrecomputeResult>;

    /**
     * 直近の precompute バッチの精度メトリクスを取得する (§4.10)
     */
    metrics(): Promise<ProgramSeriesMetrics>;
}
