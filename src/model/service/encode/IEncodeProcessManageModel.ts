import { ChildProcess, SpawnOptions } from 'child_process';

export interface CreateProcessOption {
    input: string | null;
    output: string | null;
    cmd: string; // %INPUT% と %OUTPUT% を input と output で置換する
    priority: number; // 数値が大きいほど優先度が高くなる
    /** stdout を呼び出し側が後から読む場合は false。既定値は true。 */
    drainStdout?: boolean;
    spawnOption?: SpawnOptions; // 全ての環境変数を渡す場合は spawnOption.env は null or undefined とすること
}

export default interface IEncodeProcessManageModel {
    create(option: CreateProcessOption): Promise<ChildProcess>;
}
