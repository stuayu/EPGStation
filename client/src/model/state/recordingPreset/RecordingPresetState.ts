import { inject, injectable } from 'inversify';
import IRecordingPresetApiModel, { RecordingPresetInput, RecordingPresetItem } from '../../api/recordingPreset/IRecordingPresetApiModel';
import IRecordingPresetState from './IRecordingPresetState';

@injectable()
export default class RecordingPresetState implements IRecordingPresetState {
    private items: RecordingPresetItem[] = [];
    constructor(@inject('IRecordingPresetApiModel') private api: IRecordingPresetApiModel) {}

    public getItems(): RecordingPresetItem[] {
        return this.items;
    }
    public async fetch(): Promise<void> {
        this.items = (await this.api.gets()).items;
    }
    public getDefault(): Promise<RecordingPresetItem | null> {
        return this.api.getDefault();
    }
    public async add(input: RecordingPresetInput): Promise<void> {
        await this.api.add(input);
        await this.fetch();
    }
    public async update(id: number, input: RecordingPresetInput): Promise<void> {
        await this.api.update(id, input);
        await this.fetch();
    }
    public async delete(id: number): Promise<void> {
        await this.api.delete(id);
        await this.fetch();
    }
}
