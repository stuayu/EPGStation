import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import { TsInfo } from '../recorded/ts/ITsInfoAnalyzer';

/**
 * TS 解析結果を録画情報へ反映するときの挙動
 */
export interface TsInfoApplyOption {
    // true にすると番組の概要・詳細・ジャンル・映像音声情報を TS の内容で上書きする。
    // 省略時 (false) は空の項目だけ補う。
    // 過去の解析ロジックで前番組の EIT[p/f] を拾ってしまった録画を直すために、
    // 明示的な再解析 (全件強制再解析 / 録画 1 件の再解析) からのみ true にする
    overwriteProgramInfo?: boolean;
}

export default interface IVideoFileAnalyzeModel {
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    analyzeTsInfo(videoFileId: apid.VideoFileId, option?: TsInfoApplyOption): Promise<boolean>;
    saveTsInfo(videoFileId: apid.VideoFileId, info: TsInfo, option?: TsInfoApplyOption): Promise<void>;
    analyzeAll(videoFileId: apid.VideoFileId): Promise<void>;
    /**
     * 保存済みの TS 解析結果から放送局を録画情報へ反映する (ファイルは読み直さない)
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean> 反映した場合 true
     */
    applyStoredChannelInfo(videoFileId: apid.VideoFileId): Promise<boolean>;
    toMetadataResult(video: VideoFile): apid.VideoFileMetadataResult;
}
