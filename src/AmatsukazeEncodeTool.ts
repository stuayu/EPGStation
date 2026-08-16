import { spawn } from 'child_process';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { install } from 'source-map-support';
import AmatsukazeOutputUtil from './model/amatsukaze/AmatsukazeOutputUtil';
import AmatsukazeTextUtil from './model/amatsukaze/AmatsukazeTextUtil';
import AmatsukazeRpcClient from './model/amatsukaze/AmatsukazeRpcClient';
import AmatsukazeTaskWatcher from './model/amatsukaze/AmatsukazeTaskWatcher';
import {
    ResolvedAmatsukazeConfig,
    resolveAmatsukazeConfig,
    toRemotePath,
} from './model/amatsukaze/AmatsukazeConfigResolver';
import { AmatsukazeTaskProgress, AmatsukazeTaskResult } from './model/amatsukaze/IAmatsukazeTaskWatcher';
import IConfigFile from './model/IConfigFile';

install();

/**
 * Amatsukaze へエンコードを依頼するエンコードコマンド
 *
 * config.yml の encode に
 *   cmd: '%NODE% %ROOT%/dist/AmatsukazeEncodeTool.js <プロファイル名>'
 * と書いて使う。
 *
 * 1. AmatsukazeAddTask で AmatsukazeServer のキューへタスクを積む
 * 2. AmatsukazeServer へ TCP 接続して自分のタスクを追跡し、進捗・処理状況を
 *    {"type":"progress","percent":0.6,"log":"..."} 形式で標準出力へ流す
 *    (EncoderModel がこれを読み、エンコード画面の進捗バーと状態表示になる)
 * 3. 完了したら Amatsukaze の出力ファイルを EPGStation が期待するパス (OUTPUT) へ移動する
 * 4. 失敗した場合は失敗理由を標準エラーへ出して終了コード 1 で終わる
 *
 * 中断 (SIGINT / SIGTERM) を受けたときは Amatsukaze 側のキューからもタスクを取り消す。
 */
namespace AmatsukazeEncodeTool {
    /** 異常終了時の終了コード */
    const EXIT_FAILED = 1;

    /** config.yml のパス (Configuration.CONFIG_FILE_PATH と同じ場所) */
    const CONFIG_FILE_PATH = path.join(__dirname, '..', 'config', 'config.yml');

    /**
     * config.yml を読む。
     *
     * このスクリプトは録画エンコードのたびに単独プロセスとして起動されるため、
     * DI コンテナ (ログの初期化・DB 接続を伴う) は使わず config.yml だけを読む。
     * 画面から変更した設定 (DB オーバーレイ) は読まないので、amatsukaze の設定は
     * ConfigSchema 上でも yml 限定 (editable: 'ymlOnly') にしてある
     * @return IConfigFile
     */
    const readConfig = (): IConfigFile => {
        const source = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
        const config = yaml.load(source);
        if (typeof config !== 'object' || config === null) {
            throw new Error(`config.yml を読み込めませんでした: ${CONFIG_FILE_PATH}`);
        }

        return config as IConfigFile;
    };

    /**
     * 進捗を EncoderModel が読める形式で標準出力へ出す
     * @param percent: number 0〜1
     * @param log: string
     */
    const printProgress = (percent: number, log: string): void => {
        console.log(JSON.stringify({ type: 'progress', percent: percent, log: log }));
    };

    /**
     * 標準エラーへログを出す (EncoderModel の debug ログに出る)
     * @param message: string
     */
    const printLog = (message: string): void => {
        console.error(`[AmatsukazeEncodeTool] ${message}`);
    };

    /**
     * AmatsukazeAddTask を実行してキューへタスクを積む
     * @param config: ResolvedAmatsukazeConfig
     * @param profile: string プロファイル名
     * @param srcPath: string Amatsukaze から見た入力ファイルのパス
     * @param outputDir: string Amatsukaze から見た出力先ディレクトリ
     * @return Promise<void>
     */
    const addTask = (
        config: ResolvedAmatsukazeConfig,
        profile: string,
        srcPath: string,
        outputDir: string,
    ): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            if (config.addTaskPath === null) {
                reject(new Error('config.yml の amatsukaze.addTaskPath が設定されていません'));

                return;
            }

            const args: string[] = [];
            // Windows 以外では mono 経由で .exe を実行する
            const bin = config.monoPath === null ? config.addTaskPath : config.monoPath;
            if (config.monoPath !== null) {
                args.push(config.addTaskPath);
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

            printLog(`add task: ${bin} ${args.join(' ')}`);

            const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            // AmatsukazeAddTask は日本語 Windows の ANSI コードページ (cp932) で出力するため、
            // 行が完結してからまとめて変換する (チャンクの切れ目で変換すると日本語が化ける)
            const stdoutDecoder = new AmatsukazeTextUtil.LineDecoder();
            const stderrDecoder = new AmatsukazeTextUtil.LineDecoder();
            const printLines = (lines: string[]): void => {
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.length > 0) {
                        printLog(`AddTask: ${trimmed}`);
                    }
                }
            };

            child.stdout.on('data', data => {
                printLines(stdoutDecoder.push(data));
            });
            child.stderr.on('data', data => {
                printLines(stderrDecoder.push(data));
            });

            child.on('error', err => {
                reject(err);
            });

            child.on('close', code => {
                // 改行で終わらなかった分を取りこぼさない
                printLines([stdoutDecoder.flush(), stderrDecoder.flush()].filter(line => line !== null) as string[]);

                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`AmatsukazeAddTask が終了コード ${code} で終了しました`));
                }
            });
        });
    };

    /**
     * 実際の出力ファイルを EncoderModel へ伝える。
     * EncoderModel はこのパスを結果として登録する
     * @param filePath: string
     */
    const printOutputPath = (filePath: string): void => {
        console.log(JSON.stringify({ type: 'output', path: filePath }));
    };

    /**
     * 完了したタスクの出力を EPGStation へ反映する。
     *
     * **出力ファイルは Amatsukaze が書いた場所をそのまま使う** (`%OUTPUT%` へは移動しない)。
     * Amatsukaze は出力先ディレクトリしか受け付けず、ファイル名は入力 TS から自分で決めて
     * **同名があれば上書きする**。一方 EPGStation は `%OUTPUT%` を決めるときに重複を避けて
     * `(1)` を付けるため、両者の名前が食い違うことがある。
     * 移動で揃えようとすると、タスク完了直後は Amatsukaze がまだファイルを掴んでいて
     * `EBUSY` になり、エンコードは成功しているのに録画として登録されない
     * @param result: AmatsukazeTaskResult
     * @param output: string EPGStation が用意した出力ファイルパス (拡張子の確認にだけ使う)
     * @return Promise<void>
     */
    const applyOutput = async (result: AmatsukazeTaskResult, output: string): Promise<void> => {
        let outputPath = result.outputPath;
        if (result.outputPathBase !== null) {
            // DstPath は拡張子なしのベース名。入力ファイルを除外して残った動画候補から
            // 実際の拡張子を自動判定する (プロファイルごとの suffix 設定に依存しない)。
            const resolvedOutputPath = AmatsukazeOutputUtil.findOutputByBase(result.outputPathBase, null, [
                result.sourcePath,
            ]);
            if (
                resolvedOutputPath !== null &&
                (outputPath === null || path.resolve(outputPath) !== path.resolve(resolvedOutputPath))
            ) {
                if (outputPath !== null) {
                    printLog(`prefer output suffix: ${outputPath} -> ${resolvedOutputPath}`);
                } else {
                    printLog(`resolved output from base: ${result.outputPathBase} -> ${resolvedOutputPath}`);
                }
                outputPath = resolvedOutputPath;
            }
        }
        if (outputPath === null && result.outputPathBase !== null) {
            // ActualDstPath を返さない Amatsukaze では DstPath から実ファイルを探す
            outputPath = AmatsukazeOutputUtil.findOutputByBase(result.outputPathBase, null, [result.sourcePath]);
            if (outputPath !== null) {
                printLog(`resolved output from base: ${result.outputPathBase} -> ${outputPath}`);
            }
        }

        if (outputPath === null) {
            throw new Error(
                'Amatsukaze から出力ファイルのパスを取得できませんでした' +
                    (result.outputPathBase === null ? '' : ` (探索したパス: ${result.outputPathBase}.*)`),
            );
        }

        if (fs.existsSync(outputPath) === false) {
            throw new Error(`Amatsukaze の出力ファイルが見つかりません: ${outputPath}`);
        }

        const srcExtension = path.extname(outputPath).toLowerCase();
        const destExtension = path.extname(output).toLowerCase();
        if (srcExtension !== destExtension) {
            printLog(
                `Amatsukaze の出力拡張子 (${srcExtension}) がエンコードプリセットの suffix (${destExtension}) と異なります。` +
                    'プリセットの suffix を Amatsukaze のプロファイルに合わせてください',
            );
        }

        if (path.resolve(outputPath) !== path.resolve(output)) {
            printLog(`use Amatsukaze output as is: ${outputPath} (EPGStation planned: ${output})`);
        }
        printOutputPath(outputPath);
    };

    /**
     * エントリポイント
     * @return Promise<void>
     */
    export const run = async (): Promise<void> => {
        const input = process.env.INPUT;
        const output = process.env.OUTPUT;
        if (typeof input === 'undefined' || typeof output === 'undefined') {
            throw new Error('環境変数 INPUT / OUTPUT が設定されていません');
        }

        const config = resolveAmatsukazeConfig(readConfig());
        const profile = process.argv[2] ?? config.profile;
        if (typeof profile !== 'string' || profile.length === 0) {
            throw new Error(
                'Amatsukaze のプロファイル名が指定されていません (エンコードコマンドの引数か config.yml の amatsukaze.profile で指定してください)',
            );
        }

        const remoteInput = toRemotePath(input, config.pathMappings);
        const remoteOutputDir = toRemotePath(path.dirname(output), config.pathMappings);

        printProgress(0, 'Amatsukaze へタスクを登録しています');

        const client = new AmatsukazeRpcClient(config.host, config.port, config.connectTimeoutMs);
        const watcher = new AmatsukazeTaskWatcher(client, remoteInput, config.pathMappings, config.taskTimeoutMs);

        // 先に接続しておき、投入直後の状態変化を取りこぼさないようにする
        await client.connect();

        const finished = new Promise<AmatsukazeTaskResult>((resolve, reject) => {
            watcher.on('update', (progress: AmatsukazeTaskProgress) => {
                printProgress(progress.percent, progress.log);
            });
            watcher.on('finish', (result: AmatsukazeTaskResult) => {
                resolve(result);
            });
            watcher.on('error', (err: Error) => {
                reject(err);
            });
            client.on('close', () => {
                reject(new Error('AmatsukazeServer との接続が切断されました'));
            });
            client.on('error', (err: Error) => {
                printLog(`rpc error: ${err.message}`);
            });
        });

        await watcher.start();
        // requestAll() は要求送信完了しか待たないため、初期キューを受信してから投入する。
        // これにより同じ入力ファイルの過去タスクを今回のタスクと誤認しない。
        await watcher.waitForInitialQueueSnapshot();
        await addTask(config, profile, remoteInput, remoteOutputDir);
        // 投入前からキューに居るアイテム (前回失敗した同じ録画のタスクなど) を
        // 自分のタスクと取り違えないよう、探索はここから始めさせる
        watcher.markTaskAdded();

        // 中断されたら Amatsukaze 側のタスクも取り消す
        let isCanceling = false;
        const onSignal = (signal: NodeJS.Signals): void => {
            if (isCanceling === true) {
                return;
            }
            isCanceling = true;
            printLog(`${signal} を受信したため Amatsukaze のタスクをキャンセルします`);
            watcher
                .cancel()
                .catch(err => printLog(`cancel failed: ${err.message}`))
                .then(() => {
                    watcher.stop();
                    client.close();
                    process.exit(EXIT_FAILED);
                });
        };
        process.on('SIGINT', () => onSignal('SIGINT'));
        process.on('SIGTERM', () => onSignal('SIGTERM'));

        try {
            const result = await finished;

            if (result.isSucceeded === false) {
                throw new Error(
                    `Amatsukaze でのエンコードに失敗しました (${result.state}): ${result.failReason ?? '理由不明'}`,
                );
            }

            await applyOutput(result, output);
            printProgress(1, 'Amatsukaze でのエンコードが完了しました');
            printLog(
                `finished: ${output}` +
                    (result.encodeTimeMs === null ? '' : ` (${Math.round(result.encodeTimeMs / 1000)} 秒)`),
            );
        } finally {
            watcher.stop();
            client.close();
        }
    };
}

AmatsukazeEncodeTool.run()
    .then(() => {
        // 監視用のタイマー・ソケットが残っていても確実に終わらせる
        process.exit(0);
    })
    .catch(err => {
        console.error(`[AmatsukazeEncodeTool] ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
