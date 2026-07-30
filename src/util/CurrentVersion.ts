import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildGitArgs, resolveGitCommand } from './GitCommand';

/**
 * 動作中の EPGStation のバージョンを求める。
 * git 管理下ではチェックアウト中のタグを優先する。
 * package.json の version はリリースタグの日付サフィックス (`-260727`) を持たないため、
 * これだけを見ると更新チェックの比較対象と表示がずれてしまう
 */

// dist/util から 2 つ上が EPGStation の設置ディレクトリ
const ROOT_PATH = path.join(__dirname, '..', '..');

let cached: string | null = null;

/**
 * 短時間で終わるコマンドを同期実行する。失敗時は null
 */
const run = (command: string, args: string[]): string | null => {
    try {
        const result = spawnSync(command, args, {
            cwd: ROOT_PATH,
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true,
        });
        if (result.status !== 0 || typeof result.stdout !== 'string') return null;
        const value = result.stdout.trim();
        return value === '' ? null : value;
    } catch (err) {
        return null;
    }
};

/**
 * 現在のバージョンを返す (プロセス内でキャッシュする)
 * @return string 例: '2.14.0-stuayu-260727' / タグから進んでいる場合は '2.14.0-stuayu-260727-5-gabcdef'
 */
export const getCurrentVersion = (): string => {
    if (cached !== null) return cached;

    let version: string | null = null;
    if (fs.existsSync(path.join(ROOT_PATH, '.git'))) {
        // Windows サービス (LocalSystem) から起動された場合でも git を引けるようにする
        // (PATH に git が無い / リポジトリの所有者が異なる環境への対処)
        const git = resolveGitCommand();
        version = run(git, buildGitArgs(ROOT_PATH, ['describe', '--tags', '--exact-match', 'HEAD']));
        // タグから進んでいる場合は直近のタグ + 差分
        if (version === null) version = run(git, buildGitArgs(ROOT_PATH, ['describe', '--tags', '--abbrev=7']));
    }
    if (version === null) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_PATH, 'package.json'), 'utf8'));
            version = String(pkg.version);
        } catch (err) {
            version = 'unknown';
        }
    }
    cached = version;
    return version;
};

/**
 * キャッシュを捨てる (更新の適用後に呼ぶ)
 */
export const clearCurrentVersionCache = (): void => {
    cached = null;
};
