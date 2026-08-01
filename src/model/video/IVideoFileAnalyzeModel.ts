import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import { TsInfo } from '../recorded/ts/ITsInfoAnalyzer';

export default interface IVideoFileAnalyzeModel {
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    analyzeTsInfo(videoFileId: apid.VideoFileId): Promise<boolean>;
    saveTsInfo(videoFileId: apid.VideoFileId, info: TsInfo): Promise<void>;
    analyzeAll(videoFileId: apid.VideoFileId): Promise<void>;
    /**
     * 保存済みの TS 解析結果から放送局を録画情報へ反映する (ファイルは読み直さない)
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean> 反映した場合 true
     */
    applyStoredChannelInfo(videoFileId: apid.VideoFileId): Promise<boolean>;
    toMetadataResult(video: VideoFile): apid.VideoFileMetadataResult;
}
