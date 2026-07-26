import ProgramSeriesLink from '../../db/entities/ProgramSeriesLink';
export interface SaveProgramSeriesLink {
    programId: number;
    seriesId: number;
    episodeId: number | null;
    confidence: number;
    source: string;
    manualLock: boolean;
    updatedAt: number;
}
export default interface IProgramSeriesDB {
    get(programId: number): Promise<ProgramSeriesLink | null>;
    save(value: SaveProgramSeriesLink): Promise<ProgramSeriesLink>;
}
