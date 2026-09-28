import * as apid from '../../../../api';

export default interface ITunerApiModel {
    gets(): Promise<apid.TunerItems>;
}
