import * as apid from '../../../../api';

export default interface IConfigApiModel {
    getConfig(isSecure: boolean, accessPort?: number | null): Promise<apid.Config>;
}
