import * as child_process from 'child_process';

/**
 * Operator (親) が spawn した子プロセス (Service / EPGUpdater) の一覧。
 *
 * Operator が自分で終了する場面 (更新後の再起動・画面からの再起動) では、
 * 子プロセスは自動では終了しない。Service が生き残るとポートを握ったままになり、
 * 新しく起動した Operator の Service が待ち受けられなくなるため、終了前にまとめて止める。
 */
const children = new Set<child_process.ChildProcess>();

// 自分から止めた場合まで「落ちた」とみなして再起動されないようにするためのフラグ
let shuttingDown = false;

/**
 * 子プロセスを登録する。終了時に自動で登録を外す
 * @param child: child_process.ChildProcess
 */
export const registerChildProcess = (child: child_process.ChildProcess): void => {
    children.add(child);
    child.once('exit', () => {
        children.delete(child);
    });
};

/**
 * Operator 自身の終了処理が始まっているか。
 * true の場合、子プロセスの終了は異常終了ではないので再起動してはいけない
 * @return boolean
 */
export const isShuttingDown = (): boolean => shuttingDown;

/**
 * 登録済みの子プロセスをすべて終了させる
 * @param signal: NodeJS.Signals 送るシグナル (既定 SIGTERM)
 */
export const killAllChildProcesses = (signal: NodeJS.Signals = 'SIGTERM'): void => {
    shuttingDown = true;
    for (const child of children) {
        try {
            if (child.killed === false && typeof child.pid === 'number') child.kill(signal);
        } catch (err: any) {
            // 既に終了している場合は無視する
        }
    }
    children.clear();
};
