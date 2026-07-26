import * as apid from '../../../../api';

export default interface ISavedSearchApiModel {
    gets(offset?: number, limit?: number): Promise<apid.SavedSearchItems>;
    get(searchId: apid.SavedSearchId): Promise<apid.SavedSearchItem>;
    create(option: apid.AddSavedSearchOption): Promise<apid.SavedSearchId>;
    update(searchId: apid.SavedSearchId, option: apid.UpdateSavedSearchOption): Promise<void>;
    delete(searchId: apid.SavedSearchId): Promise<void>;
}
