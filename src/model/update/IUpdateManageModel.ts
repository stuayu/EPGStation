import * as apid from '../../../api';

export type UpdateReleaseInfo = apid.UpdateReleaseInfo;
export type UpdateStatus = apid.UpdateStatus;
export type UpdateJob = apid.UpdateJob;
export type RunUpdateOption = apid.RunUpdateOption;
export type UpdateRestartResult = apid.UpdateRestartResult;

export default interface IUpdateManageModel {
    /**
     * 更新状況 (現在バージョン・最新リリース・導入形態・実行中ジョブ) を返す。
     * リリース情報はキャッシュから返し、期限切れなら取得し直す
     * @return Promise<UpdateStatus>
     */
    getStatus(): Promise<UpdateStatus>;
    /**
     * キャッシュを無視して GitHub のリリース情報を取り直す
     * @return Promise<UpdateStatus>
     */
    check(): Promise<UpdateStatus>;
    /**
     * 更新を開始する (非同期。進捗は getJob で取得する)
     * @param option: RunUpdateOption
     * @return Promise<UpdateJob> 開始直後のジョブ
     */
    run(option: RunUpdateOption): Promise<UpdateJob>;
    /**
     * 実行中・直近の更新ジョブを返す
     * @return UpdateJob
     */
    getJob(): UpdateJob;
    /**
     * 更新を伴わずに EPGStation を再起動する。
     * 応答を返しきってから終了するため、戻り値は「再起動を予約した」時点のもの
     * @return UpdateRestartResult
     */
    restartApplication(): UpdateRestartResult;
    /**
     * 定期的な更新チェックを開始する (Operator 起動時に呼ぶ)
     */
    startAutoCheck(): void;
}
