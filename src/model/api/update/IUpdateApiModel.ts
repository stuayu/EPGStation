import * as apid from '../../../../api';

export type UpdateStatus = apid.UpdateStatus;
export type UpdateJob = apid.UpdateJob;
export type RunUpdateOption = apid.RunUpdateOption;
export type UpdateRestartResult = apid.UpdateRestartResult;

export default interface IUpdateApiModel {
    /**
     * 更新状況 (現在バージョン・最新リリース・導入形態・実行中ジョブ) を取得する
     * @return Promise<UpdateStatus>
     */
    getStatus(): Promise<UpdateStatus>;
    /**
     * キャッシュを無視してリリース情報を取得し直す
     * @return Promise<UpdateStatus>
     */
    check(): Promise<UpdateStatus>;
    /**
     * 更新を開始する (非同期。進捗は getJob で取得する)
     * @param option: RunUpdateOption
     * @return Promise<UpdateJob>
     */
    run(option: RunUpdateOption): Promise<UpdateJob>;
    /**
     * 実行中・直近の更新ジョブを取得する
     * @return Promise<UpdateJob>
     */
    getJob(): Promise<UpdateJob>;
    /**
     * 更新を伴わずに EPGStation を再起動する
     * @return Promise<UpdateRestartResult>
     */
    restart(): Promise<UpdateRestartResult>;
}
