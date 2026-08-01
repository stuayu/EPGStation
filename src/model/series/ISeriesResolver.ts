import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
export interface SeriesRecordingInput {
    recordedId: number;
    title: string;
    channelId: number;
    startAt: number;
    // 欠番補完予約提案 (§4.7) 経由の予約であれば、その予約 ID。
    // SeriesReservationHint が見つかった場合、通常のスコアリングより優先して episode/airType を確定させる
    reserveId?: number;
}

/**
 * シリーズ判定 1 ステップ分のトレース。
 * 「どの照会に何を投げて何が返ったか」を残し、画面から判定過程を追えるようにする
 */
export interface SeriesResolveTraceStep {
    // 判定ステップの識別子 (parse / programLookup / alias / workDictionary / llm / titleScoring / result)
    step: string;
    // 画面表示用のステップ名
    label: string;
    // このステップへの入力の要約
    input: string;
    // このステップの戻り値の要約
    output: string;
    // このステップで確定したか
    matched: boolean;
    // 生の戻り値 (JSON 文字列)
    detail?: string;
}

/**
 * resolve() に渡すトレース収集器。渡した場合のみ各ステップが push される
 */
export type SeriesResolveTrace = SeriesResolveTraceStep[];

export default interface ISeriesResolver {
    /**
     * 録画をシリーズへ解決する
     * @param recording: SeriesRecordingInput
     * @param trace: SeriesResolveTrace 判定過程の記録先 (省略可)
     * @return Promise<RecordedSeriesLink | null>
     */
    resolve(recording: SeriesRecordingInput, trace?: SeriesResolveTrace): Promise<RecordedSeriesLink | null>;
}
