import { ChildProcess, spawn } from 'child_process';
import { inject, injectable } from 'inversify';
import ProcessUtil from '../../../util/ProcessUtil';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from './IEncodeProcessManageModel';

interface ChildProcessInfo {
    child: ChildProcess;
    // 現在はプリエンプション (kill による枠の奪い合い) を行わないため
    // 比較には使用されない。option.priority をそのまま保持しているのみ。
    priority: number;
    processId: number;
}

@injectable()
class EncodeProcessManageModel implements IEncodeProcessManageModel {
    private log: ILogger;
    private maxEncode: number;
    private childs: ChildProcessInfo[] = [];

    constructor(@inject('ILoggerModel') logeer: ILoggerModel, @inject('IConfiguration') configure: IConfiguration) {
        this.log = logeer.getLogger();
        this.maxEncode = configure.getConfig().encodeProcessNum;
    }

    /**
     * 同時起動数の上限を設定する。
     * 通常エンコードと視聴用ストリームは別インスタンスでこの値を持つ。
     * @param maxProcessNum: number 同時起動数の上限
     */
    public setMaxProcessNum(maxProcessNum: number): void {
        this.maxEncode = maxProcessNum;
    }

    /**
     * エンコードプロセスを生成する
     * プロセス数が上限に達しているときは、他のプロセスを kill して枠を空けることはせず、
     * 常に reject する (プリエンプションは行わない)。
     * これは配信用エンコードと録画エンコードが互いのプロセスを kill し合い、
     * 視聴中の配信や実行中のエンコード成果 (出力ファイル) を破壊してしまう問題を避けるための方針である。
     * 呼び出し側 (EncodeManageModel) は 'EncodeProcessManageModelCreateError' を
     * 枠不足エラーとして識別し、待ちキューに戻して再試行する。
     * @param option: CreateProcessOption
     * @return Promise<ChildProcess>
     */
    public create(option: CreateProcessOption): Promise<ChildProcess> {
        return new Promise<ChildProcess>((resolve, reject) => {
            if (this.childs.length >= this.maxEncode) {
                // プロセス数が上限に達しており、kill によるプリエンプションは行わないため
                // 枠が空くまでは生成できない
                reject(new Error('EncodeProcessManageModelCreateError'));
            } else {
                // create process
                try {
                    const child = this.buildProcess(option);
                    this.childs.unshift(child);
                    resolve(child.child);
                    this.log.encode.info(`create new encode process: ${child.processId}`);
                } catch (err: any) {
                    this.log.encode.error('create encode process failed');
                    this.log.encode.error(err);
                    reject(err);
                }
            }
        });
    }

    /**
     * 指定された processId のプロセスを殺して this.childs から削除する
     * @param processId: number
     * @param isRemoveOnly: boolean true の場合はプロセスを殺さない
     * @return Promise<void>
     */
    private async killChild(processId: number, isRemoveOnly: boolean = false): Promise<void> {
        let isError = true;

        for (let i = 0; i < this.childs.length; i++) {
            if (this.childs[i].processId === processId) {
                isError = false;
                try {
                    if (isRemoveOnly === false) {
                        this.log.encode.info(`kill child: ${processId}`);
                        await ProcessUtil.kill(this.childs[i].child);
                    }
                } catch (err: any) {
                    this.log.encode.error(err);
                }

                this.childs.splice(i, 1);
                break;
            }
        }

        if (isError && isRemoveOnly === false) {
            throw new Error('EncodeProcessManageModelKillChildError');
        }
    }

    /**
     * option で指定されたコマンドのプロセスを生成する
     * @param option: CreateProcessOption
     * @return ChildProcessInfo
     */
    private buildProcess(option: CreateProcessOption): ChildProcessInfo {
        // パイプライン (例: tsreadex | ffmpeg) を含むコマンドはシェル経由で実行する
        // (Windows では cmd.exe、その他では /bin/sh が使われる)
        const useShell = option.cmd.includes('|');

        let cmds: ProcessUtil.Cmds | null = null;
        if (useShell === false) {
            try {
                cmds = ProcessUtil.parseCmdStr(option.cmd);
            } catch (err: any) {
                this.log.encode.error(`build process error: ${option.cmd}`);
                throw err;
            }
        }

        // input, output を置換
        let shellCmd = option.cmd;
        if (useShell === true) {
            if (option.input !== null) {
                shellCmd = shellCmd.replace(/%INPUT%/g, option.input);
            }
            if (option.output !== null) {
                shellCmd = shellCmd.replace(/%OUTPUT%/g, option.output);
            }
        } else if (cmds !== null) {
            for (let i = 0; i < cmds.args.length; i++) {
                if (option.input !== null) {
                    cmds.args[i] = cmds.args[i].replace(/%INPUT%/g, option.input);
                }

                if (option.output !== null) {
                    cmds.args[i] = cmds.args[i].replace(/%OUTPUT%/g, option.output);
                }
            }
        }

        // プロセス生成
        let child: ChildProcess;
        if (useShell === true) {
            this.log.encode.info(`spawn with shell: ${shellCmd}`);
            child =
                typeof option.spawnOption === 'undefined'
                    ? spawn(shellCmd, { shell: true })
                    : spawn(shellCmd, { ...option.spawnOption, shell: true });
        } else {
            const parsedCmds = cmds as ProcessUtil.Cmds;
            child =
                typeof option.spawnOption === 'undefined'
                    ? spawn(parsedCmds.bin, parsedCmds.args)
                    : spawn(parsedCmds.bin, parsedCmds.args, option.spawnOption);
        }
        const processId = new Date().getTime();

        // エラー発生時にプロセスを停止して this.childs から削除する
        child.on('error', async () => {
            await this.killChild(processId, true).catch(err => {
                this.log.encode.error(err);
            });
        });
        child.on('exit', async () => {
            await this.killChild(processId, true).catch(err => {
                this.log.encode.error(err);
            });
        });

        // buffer が埋まらないようにする
        if (child.stdout !== null) {
            child.stdout.on('data', () => {});
        }
        if (child.stderr !== null) {
            child.stderr.on('data', () => {});
        }

        // プロセスが即時終了していた場合の対処
        if (ProcessUtil.isExited(child) === true) {
            setTimeout(async () => {
                await this.killChild(processId, true).catch(err => {
                    this.log.encode.error(err);
                });
                child.removeAllListeners();
            }, 50);
        }

        return {
            child: child,
            priority: option.priority,
            processId: processId,
        };
    }
}

export default EncodeProcessManageModel;
