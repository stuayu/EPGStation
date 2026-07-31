import * as apid from '../../../../../api';

export type UpdateStatus = apid.UpdateStatus;
export type UpdateJob = apid.UpdateJob;
export type UpdateReleaseInfo = apid.UpdateReleaseInfo;
export type UpdateBranchInfo = apid.UpdateBranchInfo;
export type UpdateRestartResult = apid.UpdateRestartResult;

export default interface IUpdateApiModel {
    /**
     * 更新状況を取得する
     * @return Promise<UpdateStatus>
     */
    getStatus(): Promise<UpdateStatus>;
    /**
     * キャッシュを無視してリリース情報を取得し直す
     * @return Promise<UpdateStatus>
     */
    check(): Promise<UpdateStatus>;
    /**
     * リリース (タグ) へ更新する
     * @param tag?: string 更新先のタグ (省略時は最新リリース)
     * @param restart?: boolean 完了後に再起動するか (既定 true)
     * @return Promise<UpdateJob>
     */
    run(tag?: string, restart?: boolean): Promise<UpdateJob>;
    /**
     * ブランチ (既定 main) の最新コミットへ更新する
     * @param ref?: string 対象ブランチ (省略時はサーバ設定のブランチ)
     * @param restart?: boolean 完了後に再起動するか (既定 true)
     * @return Promise<UpdateJob>
     */
    runBranch(ref?: string, restart?: boolean): Promise<UpdateJob>;
    /**
     * 更新ジョブの進捗を取得する
     * @return Promise<UpdateJob>
     */
    getJob(): Promise<UpdateJob>;
    /**
     * 更新を伴わずに EPGStation を再起動する
     * @return Promise<UpdateRestartResult>
     */
    restart(): Promise<UpdateRestartResult>;
}
