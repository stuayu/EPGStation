import * as apid from '../../../api';

export type VideoAnalyzeJob = apid.VideoAnalyzeJob;
export type StartVideoAnalyzeJobOption = apid.StartVideoAnalyzeJobOption;

export default interface IVideoAnalyzeJobModel {
    /**
     * 一括解析ジョブを開始する (非同期。進捗は getJob で取得する)
     * @param option: StartVideoAnalyzeJobOption
     * @return Promise<VideoAnalyzeJob> 開始直後のジョブ
     */
    start(option: StartVideoAnalyzeJobOption): Promise<VideoAnalyzeJob>;
    /**
     * 実行中・直近のジョブを返す
     * @return VideoAnalyzeJob
     */
    getJob(): VideoAnalyzeJob;
    /**
     * 実行中のジョブに中断を要求する。区切りのよい所まで進めてから止まる
     * @return VideoAnalyzeJob
     */
    cancel(): VideoAnalyzeJob;
}
