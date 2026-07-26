import * as apid from '../../../api';
import SavedSearch from '../../db/entities/SavedSearch';

export interface FindAllSavedSearchOption {
    offset?: number;
    limit?: number;
}

export default interface ISavedSearchDB {
    insertOnce(item: SavedSearch): Promise<apid.SavedSearchId>;
    updateOnce(item: SavedSearch): Promise<void>;
    deleteOnce(searchId: apid.SavedSearchId): Promise<void>;
    findId(searchId: apid.SavedSearchId): Promise<SavedSearch | null>;
    findAll(option: FindAllSavedSearchOption): Promise<[SavedSearch[], number]>;
}
