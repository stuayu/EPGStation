import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import ILogApiModel, { GetLogContentOption } from './ILogApiModel';

@injectable()
export default class LogApiModel implements ILogApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ログファイル一覧を取得する
     * @return Promise<apid.LogFiles>
     */
    public async getFiles(): Promise<apid.LogFiles> {
        const result = await this.repository.get('/logs');

        return result.data;
    }

    /**
     * 指定したログファイルの内容を取得する
     * @param logFileId: ログファイル id
     * @param option: GetLogContentOption
     * @return Promise<apid.LogFileContent>
     */
    public async getContent(logFileId: string, option: GetLogContentOption = {}): Promise<apid.LogFileContent> {
        const query: { [key: string]: any } = {};
        if (typeof option.lines !== 'undefined') {
            query.lines = option.lines;
        }
        if (typeof option.keyword !== 'undefined' && option.keyword.length > 0) {
            query.keyword = option.keyword;
        }

        const result = await this.repository.get(`/logs/${encodeURIComponent(logFileId)}`, {
            params: query,
        });

        return result.data;
    }

    /**
     * ログファイルのダウンロード URL を返す
     * @param logFileId: ログファイル id
     * @return string
     */
    public getDownloadUrl(logFileId: string): string {
        return `./api/logs/${encodeURIComponent(logFileId)}/download`;
    }
}
