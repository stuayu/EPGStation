import IRecordingPresetApiModel, { RecordingPresetInput, RecordingPresetItem, RecordingPresetSettings } from '../../api/recordingPreset/IRecordingPresetApiModel';

export default interface IRecordingPresetState {
    getItems(): RecordingPresetItem[];
    fetch(): Promise<void>;
    getDefault(): Promise<RecordingPresetItem | null>;
    add(input: RecordingPresetInput): Promise<void>;
    update(id: number, input: RecordingPresetInput): Promise<void>;
    delete(id: number): Promise<void>;
}

export function createEmptyRecordingPresetSettings(): RecordingPresetSettings {
    return {
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
        mode1: null,
        encodeParentDirectoryName1: null,
        directory1: null,
        mode2: null,
        encodeParentDirectoryName2: null,
        directory2: null,
        mode3: null,
        encodeParentDirectoryName3: null,
        directory3: null,
        isDeleteOriginalAfterEncode: false,
        priority: 3,
        conflictPolicy: 'ALLOW_END_LACK',
        allowEndLack: true,
        startMarginSec: null,
        endMarginSec: null,
        tags: [],
    };
}
