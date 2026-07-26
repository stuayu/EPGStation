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
export default interface ISeriesResolver {
    resolve(recording: SeriesRecordingInput): Promise<RecordedSeriesLink | null>;
}
