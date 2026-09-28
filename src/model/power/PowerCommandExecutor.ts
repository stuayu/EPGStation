import { execFile } from 'child_process';
import { promisify } from 'util';
import { injectable } from 'inversify';
import IPowerCommandExecutor from './IPowerCommandExecutor';

const execFileAsync = promisify(execFile);

@injectable()
export default class PowerCommandExecutor implements IPowerCommandExecutor {
    /** 指定した電源コマンドを実行する */
    public async run(command: string, args: string[]): Promise<void> {
        await execFileAsync(command, args, { windowsHide: true, timeout: 30_000 });
    }
}
