export default interface IEPGUpdateExecutorManageModel {
    execute(): Promise<void>;
    /** EPG 更新処理が実行中か返す */
    isBusy(): boolean;
}
