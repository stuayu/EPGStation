import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import ISavedSearchApiModel from './ISavedSearchApiModel';
@injectable()
export default class SavedSearchApiModel implements ISavedSearchApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async gets(offset?: number, limit?: number): Promise<apid.SavedSearchItems> {
        return (
            await this.repository.get('/searches', {
                params: { offset, limit },
            })
        ).data;
    }

    public async get(searchId: apid.SavedSearchId): Promise<apid.SavedSearchItem> {
        return (await this.repository.get(`/searches/${searchId}`)).data;
    }

    public async add(option: apid.AddSavedSearchOption): Promise<apid.SavedSearchId> {
        return (await this.repository.post('/searches', option)).data.searchId;
    }

    public async update(searchId: apid.SavedSearchId, option: apid.UpdateSavedSearchOption): Promise<void> {
        await this.repository.put(`/searches/${searchId}`, option);
    }

    public async delete(searchId: apid.SavedSearchId): Promise<void> {
        await this.repository.delete(`/searches/${searchId}`);
    }
}
