export default interface IPowerCommandExecutor {
    /** 指定した電源コマンドを実行する */
    run(command: string, args: string[]): Promise<void>;
}
