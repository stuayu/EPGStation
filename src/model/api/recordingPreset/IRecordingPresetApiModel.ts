import * as apid from '../../../../api';

export default interface IRecordingPresetApiModel {
    gets(): Promise<apid.RecordingPresetItems>;
    get(id: number): Promise<apid.RecordingPresetItem>;
    getDefault(): Promise<apid.RecordingPresetItem | null>;
    create(option: apid.AddRecordingPresetOption): Promise<number>;
    update(id: number, option: apid.UpdateRecordingPresetOption): Promise<void>;
    delete(id: number): Promise<void>;
}
