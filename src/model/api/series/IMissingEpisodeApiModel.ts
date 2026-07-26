import * as apid from '../../../../api';
export interface MissingEpisodeProposalCandidate {
    programId: apid.ProgramId;
    channelId: apid.ChannelId;
    name: string;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
}
export interface MissingEpisodeProposal {
    seasonNumber: number;
    episodeNumber: number;
    candidates: MissingEpisodeProposalCandidate[];
}
export default interface IMissingEpisodeApiModel {
    /**
     * 欠番話数について、EPG の未来分から再放送予定の候補を検索して提案する (§4.7)
     */
    listProposals(seriesId: number): Promise<MissingEpisodeProposal[]>;
    /**
     * 提案から予約を作成する。作成された予約には airType: rerun のヒントが事前付与され、
     * 録画完了時に SeriesResolver がこのヒントを使ってシリーズ・話数・再放送種別を確定する
     */
    reserveProposal(
        seriesId: number,
        seasonNumber: number,
        episodeNumber: number,
        programId: apid.ProgramId,
    ): Promise<apid.ReserveId>;
}
