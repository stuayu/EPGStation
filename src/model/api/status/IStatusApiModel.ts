import * as apid from '../../../../api';

export default interface IStatusApiModel {
    getStatus(): Promise<apid.Status>;
}
