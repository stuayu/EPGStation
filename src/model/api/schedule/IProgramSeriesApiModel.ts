export interface ProgramSeriesResult {
    programId: number;
    seriesId: number;
    episodeId: number | null;
    confidence: number;
    source: string;
}
export default interface IProgramSeriesApiModel {
    get(programId: number): Promise<ProgramSeriesResult | null>;
}
