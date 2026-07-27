import * as apid from '../../../../../api';
export type SeriesListItem = apid.SeriesListItem;
export type SeriesListResult = apid.SeriesListResult;
export type SeriesChannel = apid.SeriesDetail['channels'][number];
export type SeriesRecording = apid.SeriesRecordedRow;
export type SeriesDetail = apid.SeriesDetail;
export type SeriesMapping = apid.SeriesMappingValue;
export type UpdateSeriesMapping = apid.UpdateSeriesMappingOption;
export type SeriesPendingMatchItem = apid.SeriesPendingMatchItem;
export type SeriesPendingListResult = apid.SeriesPendingListResult;
export type SeriesAliasItem = apid.SeriesAliasItem;
export type MissingEpisodeProposal = apid.MissingEpisodeProposal;
export type SeriesBackfillOption = apid.SeriesBackfillOption;
export type SeriesBackfillResult = apid.SeriesBackfillResult;
export type ProgramSeriesMetrics = apid.ProgramSeriesMetrics;
export default interface ISeriesApiModel {
    list(keyword?: string, offset?: number, limit?: number): Promise<SeriesListResult>;
    getMissingEpisodeProposals(seriesId: number): Promise<MissingEpisodeProposal[]>;
    get(id: number, channelId?: number): Promise<SeriesDetail>;
    getMapping(recordedId: number): Promise<SeriesMapping | null>;
    updateMapping(recordedId: number, value: UpdateSeriesMapping): Promise<SeriesMapping>;
    removeMapping(recordedId: number): Promise<void>;
    undoMapping(recordedId: number): Promise<SeriesMapping | null>;
    syncAnnict(seriesId: number): Promise<{ annictId: string; syobocalTid: number | null; title: string; score: number }>;
    listPending(offset?: number, limit?: number): Promise<SeriesPendingListResult>;
    confirmPending(pendingId: number, value: UpdateSeriesMapping): Promise<SeriesMapping>;
    rejectPending(pendingId: number): Promise<void>;
    merge(fromSeriesId: number, toSeriesId: number): Promise<apid.MergeSeriesResult>;
    split(seriesId: number, recordedIds: number[], newTitle: string): Promise<apid.SplitSeriesResult>;
    listAliases(seriesId?: number): Promise<SeriesAliasItem[]>;
    removeAlias(aliasId: number): Promise<void>;
    startBackfill(option?: SeriesBackfillOption): Promise<SeriesBackfillResult>;
    getBackfillStatus(): Promise<SeriesBackfillResult>;
    cancelBackfill(): Promise<void>;
    reserveMissingEpisode(seriesId: number, seasonNumber: number, episodeNumber: number, programId: number): Promise<{ reserveId: number }>;
    /**
     * 番組⇄シリーズ事前マッピングの精度メトリクスを取得する (§4.10)
     */
    getMetrics(): Promise<ProgramSeriesMetrics>;
}
