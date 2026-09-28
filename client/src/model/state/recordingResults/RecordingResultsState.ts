import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRecordingResultsApiModel, { RecordingResultsOption } from '../../api/recordingResults/IRecordingResultsApiModel';
import IRecordingResultsState from './IRecordingResultsState';

@injectable()
export default class RecordingResultsState implements IRecordingResultsState {
    private items: apid.RecordingResultSession[] = [];
    private total: number = 0;
    private details: Map<number, apid.RecordingResultDetail> = new Map();

    constructor(@inject('IRecordingResultsApiModel') private apiModel: IRecordingResultsApiModel) {}

    public async fetch(option: RecordingResultsOption): Promise<void> {
        const result = await this.apiModel.getResults(option);
        this.items = result.items;
        this.total = result.total;
    }

    public async fetchDetail(sessionId: number): Promise<apid.RecordingResultDetail> {
        const detail = await this.apiModel.getResult(sessionId);
        this.details.set(sessionId, detail);
        return detail;
    }

    public getItems(): apid.RecordingResultSession[] {
        return this.items;
    }

    public getTotal(): number {
        return this.total;
    }

    public getDetail(sessionId: number): apid.RecordingResultDetail | undefined {
        return this.details.get(sessionId);
    }
}
