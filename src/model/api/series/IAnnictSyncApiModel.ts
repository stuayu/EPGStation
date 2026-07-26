export interface AnnictSyncResult {
    seriesId: number;
    annictId: string;
    syobocalTid: number | null;
    title: string;
    score: number;
}
export default interface IAnnictSyncApiModel {
    sync(seriesId: number): Promise<AnnictSyncResult>;
}
