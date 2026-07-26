import * as apid from '../../../../api';

export default interface IRecordedTagApiModel {
    create(name: string, color: string, parentId?: number | null): Promise<apid.RecordedTagId>;
    update(tagId: apid.RecordedTagId, name: string, color: string, parentId?: number | null): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    delete(tagId: apid.RecordedTagId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    gets(option: apid.GetRecordedTagOption): Promise<apid.RecordedTags>;
}
