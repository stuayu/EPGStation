import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './IRecordedStreamBaseModel';
import RecordedStreamBaseModel from './RecordedStreamBaseModel';

@injectable()
export default class RecordedStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedStream' {
        return 'RecordedStream';
    }
}
