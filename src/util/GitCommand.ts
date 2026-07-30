import { spawnSync } from 'child_process';
import * as fs from 'fs';

/**
 * git / npm を「Windows サービスから起動された場合でも」実行できるようにするためのヘルパ。
 *
 * Windows サービス (winser / nssm 経由) は既定で LocalSystem アカウント・セッション 0 で動く。
 * このとき以下の理由でワンクリック更新の git / npm が失敗する。
 *
 * 1. Git for Windows を「現在のユーザーのみ」でインストールすると git.exe がユーザーの PATH
 *    にしか入らず、サービスの PATH からは見えない (spawn git ENOENT)
 * 2. リポジトリの所有者 (インストールしたユーザー) とサービスの実行アカウント (SYSTEM) が
 *    異なるため、Git 2.35.2 以降の所有者チェックで
 *    `fatal: detected dubious ownership in repository` になり全 git コマンドが失敗する
 * 3. Windows の npm は npm.cmd であり、Node 20 以降は `shell: false` で .cmd を spawn できない
 *    (EINVAL。CVE-2024-27980 の対策で禁止された)
 *
 * 1 は既知の場所から git.exe を探し、2 は `-c safe.directory=<repo>` をコマンド単位で付け、
 * 3 は Windows のみ shell 経由で起動することで回避する。
 * サービス登録スクリプト (`scripts/install-win-service.ps1`) 側でも PATH と
 * `git config --system safe.directory` を設定するが、既に登録済みのサービスや
 * 手動で sc.exe から登録した環境でも動くように実行時にも手当てしている
 */

export interface GitExecutableInput {
    platform: string;
    env: Record<string, string | undefined>;
    // PATH 上の git が実行できるか (呼び出し側で確認した結果)
    isInPath: boolean;
    // 実行ファイルの存在確認 (テストから差し替えられるようにする)
    exists: (filePath: string) => boolean;
}

/**
 * Git for Windows の既定のインストール先。
 * cmd\git.exe を使う (bin\git.exe ではなく cmd\ 側が公式に推奨されている呼び出し口)
 */
const WINDOWS_GIT_CANDIDATES: readonly string[] = [
    '%ProgramFiles%\\Git\\cmd\\git.exe',
    '%ProgramW6432%\\Git\\cmd\\git.exe',
    '%ProgramFiles(x86)%\\Git\\cmd\\git.exe',
    '%LOCALAPPDATA%\\Programs\\Git\\cmd\\git.exe',
    '%USERPROFILE%\\scoop\\shims\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
];

/**
 * `%VAR%` 形式の環境変数を展開する。未定義の変数を含む場合は null
 */
const expandWindowsPath = (value: string, env: Record<string, string | undefined>): string | null => {
    // 参照している変数がすべて解決できることを先に確認する (途中まで展開したパスは使わない)
    for (const match of value.matchAll(/%([^%]+)%/g)) {
        const resolved = env[match[1]];
        if (typeof resolved !== 'string' || resolved === '') return null;
    }
    return value.replace(/%([^%]+)%/g, (_match, name: string) => env[name] as string);
};

/**
 * git 実行ファイルの場所を決める。
 * PATH 上で見つかる場合と Windows 以外は 'git' をそのまま使う
 * @param input: GitExecutableInput
 * @return string
 */
export const findGitExecutable = (input: GitExecutableInput): string => {
    if (input.isInPath === true || input.platform !== 'win32') return 'git';

    for (const candidate of WINDOWS_GIT_CANDIDATES) {
        const expanded = expandWindowsPath(candidate, input.env);
        if (expanded === null) continue;
        if (input.exists(expanded) === true) return expanded;
    }

    // 見つからない場合は 'git' を返す。呼び出し側で ENOENT として扱われる
    return 'git';
};

let cachedGitCommand: string | null = null;

/**
 * PATH 上の git が実行できるか確認する
 */
const isGitInPath = (): boolean => {
    try {
        const result = spawnSync('git', ['--version'], {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true,
            shell: false,
        });
        return result.error === undefined && result.status === 0;
    } catch (err) {
        return false;
    }
};

/**
 * git 実行ファイルのパスを返す (プロセス内でキャッシュする)
 * @return string
 */
export const resolveGitCommand = (): string => {
    if (cachedGitCommand !== null) return cachedGitCommand;
    cachedGitCommand = findGitExecutable({
        platform: process.platform,
        env: process.env,
        isInPath: isGitInPath(),
        exists: filePath => fs.existsSync(filePath),
    });
    return cachedGitCommand;
};

/**
 * git に渡すパス表記へ変換する。
 * Windows でも git の設定値には `/` 区切りを渡す (`C:\EPGStation` → `C:/EPGStation`)
 * @param dirPath: string
 * @return string
 */
export const toGitPath = (dirPath: string): string => dirPath.replace(/\\/g, '/');

/**
 * git の引数を組み立てる。
 * リポジトリの所有者とプロセスの実行アカウントが異なる環境 (Windows サービス、
 * Linux で別ユーザーの systemd ユニット等) でも失敗しないよう safe.directory を都度渡す。
 * 設定ファイルを書き換えないため、実行アカウントを変えても副作用が残らない
 * @param repositoryPath: string リポジトリのルート
 * @param args: string[] git のサブコマンド以降
 * @return string[]
 */
export const buildGitArgs = (repositoryPath: string, args: string[]): string[] => [
    '-c',
    `safe.directory=${toGitPath(repositoryPath)}`,
    ...args,
];

export interface NpmCommand {
    command: string;
    // Windows の npm.cmd は shell 経由でしか起動できない
    shell: boolean;
}

/**
 * npm の実行方法を返す
 * @param platform: string
 * @return NpmCommand
 */
export const resolveNpmCommand = (platform: string = process.platform): NpmCommand =>
    platform === 'win32' ? { command: 'npm.cmd', shell: true } : { command: 'npm', shell: false };

/**
 * キャッシュを捨てる (テスト用)
 */
export const clearGitCommandCache = (): void => {
    cachedGitCommand = null;
};
