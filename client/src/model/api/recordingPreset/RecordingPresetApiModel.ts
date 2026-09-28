import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import IRecordingPresetApiModel, { RecordingPresetInput, RecordingPresetItem } from './IRecordingPresetApiModel';

@injectable()
export default class RecordingPresetApiModel implements IRecordingPresetApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async gets(): Promise<{ items: RecordingPresetItem[]; total: number }> {
        return (await this.repository.get('/recording-presets')).data;
    }

    public async getDefault(): Promise<RecordingPresetItem | null> {
        return (await this.repository.get('/recording-presets/default')).data;
    }

    public async add(input: RecordingPresetInput): Promise<number> {
        return (await this.repository.post('/recording-presets', input)).data.presetId;
    }

    public async update(id: number, input: RecordingPresetInput): Promise<void> {
        await this.repository.put(`/recording-presets/${id}`, input);
    }

    public async delete(id: number): Promise<void> {
        await this.repository.delete(`/recording-presets/${id}`);
    }
}
