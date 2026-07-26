import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
export interface SeriesRecordingInput {
    recordedId: number;
    title: string;
    channelId: number;
    startAt: number;
}
export default interface ISeriesResolver {
    resolve(recording: SeriesRecordingInput): Promise<RecordedSeriesLink | null>;
}
