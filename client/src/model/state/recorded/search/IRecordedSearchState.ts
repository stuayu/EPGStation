import * as apid from '../../../../../../api';

export interface SelectorItem {
    title: string;
    value: number;
}

/**
 * 階層タグ表示用の select item (親子関係をインデントで表現)
 */
export interface TagTreeItem {
    title: string;
    value: apid.RecordedTagId;
}

export default interface IRecordedSearchState {
    keyword: string | undefined;
    hasOriginalFile: boolean;
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    genre: apid.ProgramGenreLv1 | undefined;
    tagId: apid.RecordedTagId | undefined;
    ruleKeyword: string | null;
    ruleItems: apid.RuleKeywordItem[];
    channelItems: SelectorItem[];
    genreItems: SelectorItem[];
    tagItems: TagTreeItem[];
    fetchData(): Promise<void>;
    initValues(): void;
    updateRuleItems(): Promise<void>;
    /**
     * タグ一覧を取得し、階層構造 (親→子) を維持した順序で tagItems へ詰め直す (advancedSearch 機能有効時のみ利用想定)
     */
    fetchTagItems(): Promise<void>;
}
