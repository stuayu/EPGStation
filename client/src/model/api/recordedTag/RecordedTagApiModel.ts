import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IRecordedTagApiModel from './IRecordedTagApiModel';
@injectable()
export default class RecordedTagApiModel implements IRecordedTagApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async gets(option: apid.GetRecordedTagOption = {}): Promise<apid.RecordedTags> {
        return (
            await this.repository.get('/tags', {
                params: option,
            })
        ).data;
    }

    public async add(name: string, color: string, parentId?: number | null): Promise<apid.RecordedTagId> {
        return (
            await this.repository.post('/tags', {
                name: name,
                color: color,
                parentId: parentId,
            })
        ).data.tagId;
    }

    public async update(tagId: apid.RecordedTagId, name: string, color: string, parentId?: number | null): Promise<void> {
        await this.repository.put(`/tags/${tagId}`, {
            name: name,
            color: color,
            parentId: parentId,
        });
    }

    public async delete(tagId: apid.RecordedTagId): Promise<void> {
        await this.repository.delete(`/tags/${tagId}`);
    }

    public async setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.repository.put(`/tags/${tagId}/relate`, {
            recordedId: recordedId,
        });
    }

    public async deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.repository.delete(`/tags/${tagId}/relate`, {
            params: { recordedId: recordedId },
        });
    }
}
