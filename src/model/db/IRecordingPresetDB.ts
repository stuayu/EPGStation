import RecordingPreset from '../../db/entities/RecordingPreset';

export default interface IRecordingPresetDB {
    findAll(): Promise<RecordingPreset[]>;
    findId(id: number): Promise<RecordingPreset | null>;
    findDefault(): Promise<RecordingPreset | null>;
    insert(item: RecordingPreset): Promise<number>;
    update(item: RecordingPreset): Promise<void>;
    delete(id: number): Promise<void>;
}
