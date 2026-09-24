import { ResolvedAmatsukazeConfig } from './AmatsukazeConfigResolver';

export interface AmatsukazeCommand {
    bin: string;
    args: string[];
}

/**
 * AmatsukazeAddTask の起動コマンドを組み立てる
 * @param config: ResolvedAmatsukazeConfig
 * @param profile: string プロファイル名
 * @param srcPath: string Amatsukaze から見た入力パス
 * @param outputDir: string Amatsukaze から見た出力ディレクトリ
 * @return AmatsukazeCommand
 */
export const buildAddTaskCommand = (
    config: ResolvedAmatsukazeConfig,
    profile: string,
    srcPath: string,
    outputDir: string,
): AmatsukazeCommand => {
    const args: string[] = [...config.addTaskLauncher.slice(1)];
    let bin = config.addTaskPath as string;

    if (config.addTaskLauncher.length > 0) {
        bin = config.addTaskLauncher[0];
        if (config.monoPath !== null) {
            args.push(config.monoPath);
        }
        args.push(config.addTaskPath as string);
    } else if (config.monoPath !== null) {
        bin = config.monoPath;
        args.push(config.addTaskPath as string);
    }

    args.push('-f', srcPath);
    args.push('-ip', config.host);
    args.push('-p', String(config.port));
    args.push('-o', outputDir);
    args.push('-s', profile);
    args.push('--priority', String(config.priority));
    if (config.amatsukazeRoot !== null) {
        args.push('-r', config.amatsukazeRoot);
    }
    if (config.noMove === true) {
        args.push('--no-move');
    }

    return { bin, args };
};
