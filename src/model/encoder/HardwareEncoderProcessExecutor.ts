import { spawn } from 'child_process';
import { injectable } from 'inversify';
import IHardwareEncoderProcessExecutor, { HardwareEncoderProcessResult } from './IHardwareEncoderProcessExecutor';

/** 外部エンコーダ検出用の、タイムアウト付きプロセス実行器。 */
@injectable()
export default class HardwareEncoderProcessExecutor implements IHardwareEncoderProcessExecutor {
    public run(command: string, args: readonly string[], timeoutMs: number): Promise<HardwareEncoderProcessResult> {
        return new Promise(resolve => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            const finish = (exitCode: number | null): void => {
                if (settled === true) return;
                settled = true;
                clearTimeout(timer);
                resolve({ exitCode, stdout, stderr });
            };
            const timer = setTimeout(() => {
                child.kill();
                finish(null);
            }, timeoutMs);

            child.stdout?.on('data', data => {
                stdout += String(data);
            });
            child.stderr?.on('data', data => {
                stderr += String(data);
            });
            child.once('error', () => finish(null));
            child.once('close', code => finish(code));
        });
    }
}
