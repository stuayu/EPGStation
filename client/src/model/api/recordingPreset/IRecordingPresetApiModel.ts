export interface RecordingPresetSettings {
    parentDirectoryName: string | null;
    directory: string | null;
    recordedFormat: string | null;
    mode1: string | null;
    encodeParentDirectoryName1: string | null;
    directory1: string | null;
    mode2: string | null;
    encodeParentDirectoryName2: string | null;
    directory2: string | null;
    mode3: string | null;
    encodeParentDirectoryName3: string | null;
    directory3: string | null;
    isDeleteOriginalAfterEncode: boolean;
    priority: number;
    conflictPolicy: string;
    allowEndLack: boolean;
    startMarginSec: number | null;
    endMarginSec: number | null;
    tags: number[];
}

export interface RecordingPresetItem {
    id: number;
    name: string;
    isDefault: boolean;
    settings: RecordingPresetSettings;
    createdAt: number;
    updatedAt: number;
}

export interface RecordingPresetInput {
    name: string;
    isDefault?: boolean;
    settings: RecordingPresetSettings;
}

export default interface IRecordingPresetApiModel {
    gets(): Promise<{ items: RecordingPresetItem[]; total: number }>;
    getDefault(): Promise<RecordingPresetItem | null>;
    add(input: RecordingPresetInput): Promise<number>;
    update(id: number, input: RecordingPresetInput): Promise<void>;
    delete(id: number): Promise<void>;
}
