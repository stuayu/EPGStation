import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

namespace ProcessUtil {
    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    export const kill = (child: ChildProcess, wait = 500): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            try {
                if (child.stdin !== null) {
                    child.stdin.end();
                }
                if (child.stdout !== null) {
                    child.stdout.unpipe();
                    child.stdout.destroy();
                    child.stdout.removeAllListeners('data');
                }
                if (child.stderr !== null) {
                    child.stderr.unpipe();
                    child.stderr.destroy();
                    child.stderr.removeAllListeners('data');
                }

                setTimeout(() => {
                    child.kill('SIGINT');
                    resolve();
                }, wait);
            } catch (err: any) {
                reject(err);
            }
        });
    };

    export interface Cmds {
        bin: string;
        args: string[];
    }

    export const ROOT_PATH = path.join(__dirname, '..', '..').replace(new RegExp(`\\${path.sep}$`), '');

    /**
     * 渡された cmd 文字列を bin と args に分離する
     * @param cmd: string
     * @return ProcessUtil.Cmds
     */
    export const parseCmdStr = (cmd: string): ProcessUtil.Cmds => {
        let args = cmd.split(' ');
        let bin = args.shift();
        if (typeof bin === 'undefined') {
            throw new Error('CmdParseError');
        }

        // %NODE% の replace
        bin = bin.replace(/%NODE%/g, process.argv[0]);

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (e: any) {
            throw new Error('CmdBinIsNotFound');
        }

        args = args
            .map(arg => {
                // 引数内の %ROOT% を置換
                return arg.replace(/%ROOT%/g, ROOT_PATH);
            })
            .map(arg => {
                // 引数内の %SPACE% を半角スペースに置換
                return arg.replace(/%SPACE%/g, ' ');
            });

        return {
            bin: bin,
            args: args.filter(arg => {
                return arg.length > 0;
            }),
        };
    };

    /**
     * シェル (cmd.exe / /bin/sh) 経由で実行するコマンドへ埋め込む値を引用符で囲む。
     *
     * 録画ファイルのパスには空白・括弧・`&` などシェルの区切り文字がそのまま入るため
     * (例: `202608151635_アニメ 魔入りました!入間くん4(18)…_NHKEテレ1福島.hevc.ts`)、
     * 引用符無しで埋め込むと**コマンドが途中で切れて起動に失敗する**
     * @param value: string
     * @return string
     */
    export const quoteShellArg = (value: string): string => {
        if (process.platform === 'win32') {
            // Windows のファイル名に `"` は使えないため、そのまま囲うだけでよい
            return `"${value}"`;
        }

        // sh では `"` 内でも `$` / バッククォート / `\` が解釈されるためシングルクォートで囲む
        return `'${value.replace(/'/g, `'\\''`)}'`;
    };

    /**
     * シェル経由で実行するコマンド文字列のプレースホルダを、引用符で囲んだ値へ置換する。
     * 既に config.yml 側で `"%INPUT%"` のように引用符で囲まれている箇所は
     * 二重に囲わないよう値だけを差し込む
     * @param cmd: string
     * @param placeholder: string 置換対象 (例: '%INPUT%')
     * @param value: string
     * @return string
     */
    export const replaceShellPlaceholder = (cmd: string, placeholder: string, value: string): string => {
        let result = '';
        let index = 0;

        for (;;) {
            const found = cmd.indexOf(placeholder, index);
            if (found < 0) {
                result += cmd.slice(index);
                break;
            }

            const prev = cmd[found - 1];
            const next = cmd[found + placeholder.length];
            const isQuoted = (prev === '"' && next === '"') || (prev === "'" && next === "'");

            result += cmd.slice(index, found) + (isQuoted === true ? value : quoteShellArg(value));
            index = found + placeholder.length;
        }

        return result;
    };

    /**
     * プロセスが終了しているか
     * @param child ChildProcess
     * @return boolean 終了していれば true を返す
     */
    export const isExited = (child: ChildProcess): boolean => {
        return child.exitCode !== null;
    };
}

export default ProcessUtil;
