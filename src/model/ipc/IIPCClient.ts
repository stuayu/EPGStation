import * as apid from '../../../api';
import { OperatorFinishEncodeInfo } from '../event/IOperatorEncodeEvent';
import { ImportJobId, ImportJobStatus } from '../operator/recorded/IImportJobManageModel';
import {
    AddVideoFileOption,
    ImportedExternalRecordedFileOption,
    UploadedVideoFileOption,
} from '../operator/recorded/IRecordedManageModel';
import {
    SeriesAnalyzeResult,
    SeriesBackfillOption,
    SeriesBackfillResult,
} from '../operator/series/ISeriesBackfillManageModel';

export interface IPCReservationManageModel {
    getBroadcastStatus(): Promise<apid.BroadcastStatus>;
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    update(reserveId: apid.ReserveId): Promise<void>;
    updateRule(ruleId: apid.RuleId): Promise<void>;
    updateAll(isUntilComplete: boolean): Promise<void>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    clean(): Promise<void>;
}

export interface IPCRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<apid.RecordedId>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    deleteVideoFile(videoFileId: apid.VideoFileId, isIgnoreProtection?: boolean): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    getCleanupInfo(): Promise<apid.RecordedCleanupInfo>;
    videoFileCleanup(): Promise<void>;
    dropLogFileCleanup(): Promise<void>;
    startImportJob(items: ImportedExternalRecordedFileOption[]): Promise<ImportJobId>;
    getImportJobStatus(jobId: ImportJobId): Promise<ImportJobStatus | null>;
    retryImportJob(jobId: ImportJobId): Promise<ImportJobId | null>;
}

export interface IPCRecordedTagManageModel {
    create(name: string, color: string, parentId?: number | null): Promise<apid.RecordedTagId>;
    update(tagId: apid.RecordedTagId, name: string, color: string, parentId?: number | null): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    delete(tagId: apid.RecordedTagId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}

export interface IPCRecordingManageModel {
    resetTimer(): void;
}

export interface IPCRuleManageModel {
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    update(rule: apid.Rule): Promise<void>;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
    deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]>;
}

export interface IPCThumbnailManageModel {
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
    add(videoFileId: apid.VideoFileId): Promise<void>;
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
}

export interface IPCOperatorEncodeEvent {
    emitFinishEncode(info: OperatorFinishEncodeInfo): Promise<void>;
}

export interface IPCSeriesManageModel {
    startBackfill(option: SeriesBackfillOption): Promise<SeriesBackfillResult>;
    getBackfillStatus(): Promise<SeriesBackfillResult>;
    cancelBackfill(): Promise<void>;
    analyze(recordedId: apid.RecordedId): Promise<SeriesAnalyzeResult>;
}

export interface IPCAppSettingManageModel {
    /**
     * システム設定が更新されたことを Operator プロセスへ通知する (§6.3, fire-and-forget)。
     * 録画中の処理には影響を与えない
     * @param keys: 変更されたトップレベルキーの一覧
     */
    notifyChanged(keys: string[]): void;
}

export interface IPCUpdateManageModel {
    getStatus(): Promise<apid.UpdateStatus>;
    check(): Promise<apid.UpdateStatus>;
    run(option: apid.RunUpdateOption): Promise<apid.UpdateJob>;
    getJob(): Promise<apid.UpdateJob>;
    restart(): Promise<apid.UpdateRestartResult>;
}

export default interface IIPCClient {
    reserveation: IPCReservationManageModel;
    recorded: IPCRecordedManageModel;
    recordedTag: IPCRecordedTagManageModel;
    recording: IPCRecordingManageModel;
    rule: IPCRuleManageModel;
    thumbnail: IPCThumbnailManageModel;
    encodeEvent: IPCOperatorEncodeEvent;
    series: IPCSeriesManageModel;
    appSetting: IPCAppSettingManageModel;
    update: IPCUpdateManageModel;
}
