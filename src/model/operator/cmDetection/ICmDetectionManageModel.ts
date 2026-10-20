import * as apid from '../../../../api';

export default interface ICmDetectionManageModel {
    add(videoFileId: apid.VideoFileId): void;
}
