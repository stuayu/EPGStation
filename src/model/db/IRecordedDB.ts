import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';

export interface RecordedColumnOption {
    isNeedVideoFiles: boolean;
    isNeedThumbnails: boolean;
    isNeedsDropLog: boolean;
    isNeedTags: boolean;
}

export interface FindAllOption extends apid.GetRecordedOption {
    isRecording?: boolean;
}

// シリーズ化バックフィル (S11 §11.1) 用の軽量な録画行
export interface SeriesBackfillCandidateRow {
    id: number;
    name: string;
    channelId: number;
    startAt: number;
}

/**
 * TS 解析で放送局が特定できたときに書き戻す値
 */
export interface RecordedChannelUpdateValues {
    channelId?: apid.ChannelId;
    channelName?: string;
    halfWidthChannelName?: string;
}

export default interface IRecordedDB {
    restore(items: Recorded[]): Promise<void>;
    insertOnce(recorded: Recorded): Promise<apid.RecordedId>;
    updateOnce(recorded: Recorded): Promise<void>;
    updateChannel(recordedId: apid.RecordedId, values: RecordedChannelUpdateValues): Promise<void>;
    removeRecording(recordedId: apid.RecordedId): Promise<void>;
    removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<void>;
    removeRuleId(ruleId: apid.RuleId): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    deleteOnce(recordedId: apid.RecordedId): Promise<void>;
    findId(recordedId: apid.RecordedId): Promise<Recorded | null>;
    findIds(
        recordedIds: apid.RecordedId[],
        columnOption?: RecordedColumnOption,
        isReverse?: boolean,
    ): Promise<Recorded[]>;
    findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]>;
    findDuplicateCandidates(channelId: apid.ChannelId, startAt: number, toleranceMs: number): Promise<Recorded[]>;
    findChannelList(): Promise<apid.RecordedChannelListItem[]>;
    findGenreList(): Promise<apid.RecordedGenreListItem[]>;
    findOld(): Promise<Recorded | null>;
    findReserveId(reserveId: apid.ReserveId): Promise<Recorded[]>;

    /**
     * シリーズ化バックフィル用に録画を id 昇順でチャンク取得する (録画中のものは除く)
     * @param afterId: number この id より大きいものを対象とする
     * @param limit: number
     * @return Promise<SeriesBackfillCandidateRow[]>
     */
    findForSeriesBackfill(afterId: number, limit: number): Promise<SeriesBackfillCandidateRow[]>;

    /**
     * シリーズ化バックフィルの残件数を取得する
     * @param afterId: number この id より大きいものを対象とする
     * @return Promise<number>
     */
    countForSeriesBackfill(afterId: number): Promise<number>;
}
