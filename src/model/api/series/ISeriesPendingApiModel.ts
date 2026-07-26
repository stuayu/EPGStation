import * as apid from '../../../../api';
import { UpdateSeriesMappingOption, SeriesMappingValue } from './ISeriesMappingApiModel';
export type PendingMatchCandidate = apid.SeriesPendingMatchCandidate;
export type PendingMatchItem = apid.SeriesPendingMatchItem;
export type PendingListResult = apid.SeriesPendingListResult;
export default interface ISeriesPendingApiModel {
    /**
     * 未確定キュー一覧取得 (§9.5)
     */
    list(offset: number, limit: number): Promise<PendingListResult>;
    /**
     * 候補から確定させる (既存の手動割当ロジックを再利用)
     */
    confirm(pendingId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue>;
    /**
     * この録画はシリーズ化しない (キューから除外するのみ)
     */
    reject(pendingId: number): Promise<void>;
}
