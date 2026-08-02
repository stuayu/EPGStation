import * as apid from '../../../../../api';
import { RecordedDisplayData } from './IRecordedUtil';

export type MultipleDeletionOption = 'All' | 'OnlyOriginalFile' | 'OnlyEncodedFile';

export interface SelectedInfo {
    cnt: number;
    size: number;
}

/**
 * 複数選択した番組をまとめてエンコードするときのオプション
 */
export interface MultipleEncodeOption {
    mode: string;
    /**
     * エンコード元として使うビデオファイルの種別
     * 'ts' 指定時に ts が無い番組はスキップする
     */
    sourceType: 'ts' | 'encoded';
    isSaveSameDirectory: boolean;
    parentDir?: string;
    directory?: string;
    removeOriginal: boolean;
}

/**
 * 複数エンコード追加の実行結果
 */
export interface MultipleEncodeResult {
    /** 追加できた件数 */
    successCnt: number;
    /** 対象のビデオファイルが無く飛ばした件数 */
    skippedCnt: number;
    /** 追加に失敗した件数 */
    errorCnt: number;
}

export default interface IRecordedState {
    clearData(): void;
    fetchData(option: apid.GetRecordedOption): Promise<void>;
    setData(records: apid.Records, isHalfWidth: boolean): void;
    getRecorded(): RecordedDisplayData[];
    getTotal(): number;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    getSelectedCnt(): SelectedInfo;
    select(recordedId: apid.RecordedId): void;
    selectAll(): void;
    clearSelect(): void;
    multiplueDeletion(option: MultipleDeletionOption): Promise<void>;
    multipleEncode(option: MultipleEncodeOption): Promise<MultipleEncodeResult>;
}
