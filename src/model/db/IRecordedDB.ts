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

// シリーズ化バックフィルの対象絞り込み
export interface SeriesBackfillFilter {
    // true の場合、まだシリーズへリンクされていない録画だけを対象にする
    onlyUnlinked?: boolean;
    // この id 未満の録画は対象外にする (直近 N 件だけを対象にする際の下限)
    minId?: number;
}

/**
 * TS 解析で放送局が特定できたときに書き戻す値
 */
export interface RecordedChannelUpdateValues {
    channelId?: apid.ChannelId;
    channelName?: string;
    halfWidthChannelName?: string;
}

/**
 * TS 解析から補完する番組情報 (未設定の項目だけを埋める用途)
 */
export interface RecordedProgramUpdateValues {
    name?: string;
    halfWidthName?: string;
    description?: string;
    halfWidthDescription?: string;
    extended?: string;
    halfWidthExtended?: string;
    genre1?: number;
    subGenre1?: number;
    genre2?: number;
    subGenre2?: number;
    genre3?: number;
    subGenre3?: number;
    videoType?: string;
    videoResolution?: string;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: number;
    audioComponentType?: number;
}

export default interface IRecordedDB {
    restore(items: Recorded[]): Promise<void>;
    insertOnce(recorded: Recorded): Promise<apid.RecordedId>;
    updateOnce(recorded: Recorded): Promise<void>;
    updateChannel(recordedId: apid.RecordedId, values: RecordedChannelUpdateValues): Promise<void>;
    updateProgramInfo(recordedId: apid.RecordedId, values: RecordedProgramUpdateValues): Promise<void>;
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
     * @param filter: SeriesBackfillFilter 対象の絞り込み条件
     * @return Promise<SeriesBackfillCandidateRow[]>
     */
    findForSeriesBackfill(
        afterId: number,
        limit: number,
        filter?: SeriesBackfillFilter,
    ): Promise<SeriesBackfillCandidateRow[]>;

    /**
     * シリーズ化バックフィルの残件数を取得する
     * @param afterId: number この id より大きいものを対象とする
     * @param filter: SeriesBackfillFilter 対象の絞り込み条件
     * @return Promise<number>
     */
    countForSeriesBackfill(afterId: number, filter?: SeriesBackfillFilter): Promise<number>;

    /**
     * 直近 (id 降順) の録画 count 件のうち、最も小さい id を返す (バックフィルの対象下限)
     * @param count: number
     * @return Promise<number> 対象が無い場合は 0
     */
    findSeriesBackfillFloorId(count: number): Promise<number>;
}
