import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IRecordingResultsApiModel, { RecordingResultsOption } from './IRecordingResultsApiModel';

@injectable()
export default class RecordingResultsApiModel implements IRecordingResultsApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    /** 録画結果を検索する */
    public async getResults(option: RecordingResultsOption): Promise<apid.RecordingResultList> {
        return (await this.repository.get('/recording-results', { params: option })).data;
    }

    /** 録画結果と接続試行を取得する */
    public async getResult(sessionId: number): Promise<apid.RecordingResultDetail> {
        return (await this.repository.get(`/recording-results/${sessionId}`)).data;
    }
}
