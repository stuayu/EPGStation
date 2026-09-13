export interface HardwareEncoderProcessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export default interface IHardwareEncoderProcessExecutor {
    run(command: string, args: readonly string[], timeoutMs: number): Promise<HardwareEncoderProcessResult>;
}
