import { spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../api';
import { killAllChildProcesses } from '../../util/ChildProcessRegistry';
import { clearCurrentVersionCache, getCurrentVersion } from '../../util/CurrentVersion';
import { buildGitArgs, resolveGitCommand, resolveNpmCommand } from '../../util/GitCommand';
import { compareVersions, isNewerVersion, isPrereleaseVersion } from '../../util/VersionUtil';
import IConfiguration from '../IConfiguration';
import ILoggerModel from '../ILoggerModel';
import ILogger from '../ILogger';
import IProviderHttpClient from '../metadata/IProviderHttpClient';
import IUpdateManageModel, { RunUpdateOption, UpdateJob, UpdateStatus } from './IUpdateManageModel';
import {
    canSupervisorRestart,
    describeRestart,
    detectSupervisor,
    getWindowsServiceName,
    InstallationType,
    SupervisorType,
} from './UpdateEnvironment';

interface GitHubCommit {
    sha: string;
    html_url: string;
    commit: {
        message: string;
        author?: { date?: string };
        committer?: { date?: string };
    };
}

interface GitHubRelease {
    tag_name: string;
    name: string | null;
    prerelease: boolean;
    draft: boolean;
    published_at: string | null;
    html_url: string;
    body: string | null;
}

@injectable()
export default class UpdateManageModel implements IUpdateManageModel {
    // EPGStation の設置ディレクトリ (dist/model/update から 3 つ上)
    private static readonly ROOT_PATH = path.join(__dirname, '..', '..', '..');
    private static readonly DEFAULT_REPOSITORY = 'stuayu/EPGStation';
    // 追従先ブランチの既定値 (リリース前の修正を取り込みたい人向け)
    private static readonly DEFAULT_BRANCH = 'main';
    // リリース情報のキャッシュ有効期間 (既定 6 時間)
    private static readonly DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
    // 起動直後は他の初期化処理と重ならないよう少し待ってから初回チェックする
    private static readonly INITIAL_CHECK_DELAY_MS = 3 * 60 * 1000;
    private static readonly RELEASE_FETCH_LIMIT = 30;
    // ジョブが保持するログの最大行数
    private static readonly MAX_LOG_LINES = 500;
    // npm install / build は時間がかかるためコマンドごとの上限を長めに取る
    private static readonly COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
    // 終了前に応答を返しきるための待ち時間
    private static readonly RESTART_DELAY_MS = 2000;
    // Windows サービスの停止完了を待ってから sc start する秒数 (ping の回数)
    private static readonly SERVICE_START_WAIT_SEC = 10;

    private log: ILogger;
    private job: UpdateJob = UpdateManageModel.emptyJob();
    private latestStable: apid.UpdateReleaseInfo | null = null;
    private latestPrerelease: apid.UpdateReleaseInfo | null = null;
    private checkedAt: number | null = null;
    private checkError: string | null = null;
    private currentVersion: string | null = null;
    private currentCommit: string | null = null;
    private branchCommit: { sha: string; message: string; committedAt: number | null; htmlUrl: string } | null = null;
    private installationType: InstallationType | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
    ) {
        this.log = logger.getLogger();
    }

    private static emptyJob(): UpdateJob {
        return {
            status: 'idle',
            tag: null,
            step: null,
            startedAt: null,
            finishedAt: null,
            error: null,
            logs: [],
        };
    }

    public startAutoCheck(): void {
        const interval = this.getCheckIntervalMs();
        if (interval <= 0) {
            this.log.system.info('update check is disabled');
            return;
        }
        setTimeout(() => {
            this.refresh().catch(() => {});
            setInterval(() => {
                this.refresh().catch(() => {});
            }, interval);
        }, UpdateManageModel.INITIAL_CHECK_DELAY_MS).unref();
    }

    public async getStatus(): Promise<UpdateStatus> {
        // キャッシュが無い・古い場合だけ取り直す (画面表示のたびに GitHub を叩かない)
        const interval = this.getCheckIntervalMs();
        const expired = this.checkedAt === null || (interval > 0 && Date.now() - this.checkedAt > interval);
        if (expired === true && this.job.status !== 'running') {
            await this.refresh().catch(() => {});
        }
        return this.buildStatus();
    }

    public async check(): Promise<UpdateStatus> {
        await this.refresh();
        return this.buildStatus();
    }

    public getJob(): UpdateJob {
        return { ...this.job, logs: [...this.job.logs] };
    }

    public async run(option: RunUpdateOption): Promise<UpdateJob> {
        if (this.job.status === 'running' || this.job.status === 'restarting')
            throw new Error('UpdateIsAlreadyRunning');

        const status = await this.getStatus();
        if (status.canUpdate === false) throw new Error('UpdateIsNotSupported');

        // ブランチ追従 (main の最新へ更新) とタグ更新の 2 通りを扱う
        const isBranch = option?.refType === 'branch';
        const target = isBranch
            ? typeof option?.ref === 'string' && option.ref !== ''
                ? option.ref
                : this.getBranch()
            : typeof option?.tag === 'string' && option.tag !== ''
              ? option.tag
              : status.availableRelease?.tag;
        if (typeof target !== 'string' || target === '') throw new Error('UpdateTargetIsNotFound');
        // 任意の文字列を渡せてしまうと git checkout に危険な引数を渡せるため、書式を厳しく制限する
        // (ブランチ名だけ '/' を許す。先頭の '-' はオプションとして解釈されうるため弾く)
        const pattern = isBranch ? /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/ : /^[A-Za-z0-9._-]{1,100}$/;
        if (pattern.test(target) === false || target.startsWith('-')) throw new Error('InvalidUpdateTag');

        this.job = {
            status: 'running',
            tag: target,
            step: null,
            startedAt: Date.now(),
            finishedAt: null,
            error: null,
            logs: [],
        };
        const restart = option?.restart !== false;
        // 応答を待たせないようジョブは非同期で進める (進捗は getJob で取得する)
        this.execute(target, isBranch, restart).catch(err => {
            this.log.system.error(err);
        });
        return this.getJob();
    }

    public restartApplication(): apid.UpdateRestartResult {
        // 更新中に落とすと中途半端な状態 (checkout 済みでビルド前など) で上がってしまうため止める
        if (this.job.status === 'running' || this.job.status === 'restarting')
            throw new Error('UpdateIsAlreadyRunning');

        const supervisor = this.detectSupervisorType();
        const note = describeRestart(supervisor);
        this.log.system.info(`restart requested: ${note}`);
        this.restart(supervisor);

        return {
            supervisor,
            note,
            restartAt: Date.now() + UpdateManageModel.RESTART_DELAY_MS,
        };
    }

    /**
     * 更新の本体。git で対象タグ / ブランチへ切り替え、依存インストールとビルドを行う
     */
    private async execute(target: string, isBranch: boolean, restart: boolean): Promise<void> {
        const root = UpdateManageModel.ROOT_PATH;
        try {
            this.appendLog(
                'info',
                isBranch
                    ? `EPGStation を ${target} ブランチの最新へ更新します`
                    : `EPGStation を ${target} へ更新します`,
            );

            // ローカル変更があると checkout が失敗する / 変更を失う恐れがあるため先に止める
            this.job.step = 'ローカル変更の確認';
            const dirty = await this.runGit(['status', '--porcelain'], root);
            if (dirty.trim() !== '') {
                throw new Error(
                    'LocalChangesExist: 作業ツリーに未コミットの変更があります。手動で退避してから再実行してください',
                );
            }

            this.job.step = 'リリース情報の取得 (git fetch)';
            await this.runGit(['fetch', '--tags', '--prune', '--force'], root);

            if (isBranch === true) {
                // ローカルブランチをリモートの最新に強制的に合わせる (追従なので独自コミットは持たない前提)
                this.job.step = `更新の適用 (git checkout ${target})`;
                await this.runGit(['checkout', '-B', target, `origin/${target}`], root);
            } else {
                this.job.step = `更新の適用 (git checkout ${target})`;
                await this.runGit(['-c', 'advice.detachedHead=false', 'checkout', '--force', target], root);
            }

            this.job.step = '依存パッケージのインストール';
            await this.runNpm(['run', 'all-install'], root);

            // build スクリプトは lint --fix / prettier --write を含み作業ツリーを書き換えてしまうため、
            // 更新では型チェック + ビルドだけを実行する (次回の「ローカル変更の確認」を壊さない)
            this.job.step = 'サーバのビルド';
            await this.runNpm(['run', 'compile'], root);

            this.job.step = 'Web UI のビルド';
            await this.runNpm(['run', process.platform === 'win32' ? 'build-client-win' : 'build-client'], root);

            // 更新後はバージョン表記を取り直す
            clearCurrentVersionCache();
            this.currentVersion = null;
            this.currentCommit = null;
            this.job.status = 'succeeded';
            this.job.step = null;
            this.job.finishedAt = Date.now();
            this.appendLog('info', `${target} への更新が完了しました`);

            if (restart === true) {
                this.job.status = 'restarting';
                const supervisor = this.detectSupervisorType();
                this.appendLog('info', `再起動します: ${describeRestart(supervisor)}`);
                this.restart(supervisor);
            } else {
                this.appendLog('info', '新しいバージョンは EPGStation の再起動後に有効になります');
            }
        } catch (err: any) {
            this.job.status = 'failed';
            this.job.step = null;
            this.job.finishedAt = Date.now();
            this.job.error = err instanceof Error ? err.message : String(err);
            this.appendLog('error', this.job.error ?? 'unknown error');
            this.log.system.error('update failed');
            this.log.system.error(err);
        }
    }

    /**
     * 更新後の再起動。
     * サービス管理下ならプロセスを終了するだけで新しいコードで起動し直される。
     * 管理下でない場合のみ後継プロセスを自分で起動してから終了する
     */
    private restart(supervisor: SupervisorType): void {
        setTimeout(() => {
            try {
                if (supervisor === 'windows-service') {
                    // nssm 配下ならプロセスの終了で再起動されるが、sc.exe から直接登録された環境や
                    // 回復設定が入っていない環境では上がってこない。プロセスから切り離した cmd.exe に
                    // 遅延起動を任せ、既に起動していれば何もしない (error 1056 を無視する) 形にしておく
                    this.startWindowsService();
                } else if (canSupervisorRestart(supervisor) === false) {
                    const child = spawn(
                        process.execPath,
                        [path.join(UpdateManageModel.ROOT_PATH, 'dist', 'index.js')],
                        {
                            cwd: UpdateManageModel.ROOT_PATH,
                            detached: true,
                            stdio: 'ignore',
                            windowsHide: true,
                        },
                    );
                    child.unref();
                }
            } catch (err) {
                this.log.system.error('failed to spawn successor process');
                this.log.system.error(err);
            }
            // 子プロセス (Service / EPGUpdater) は親の終了では落ちない。
            // 残ると Service がポートを握ったままになり後継プロセスが待ち受けられないため、明示的に止める
            killAllChildProcesses();
            process.exit(0);
        }, UpdateManageModel.RESTART_DELAY_MS).unref();
    }

    /**
     * Windows サービスを起こし直す。
     * 自分が終了したあとに実行される必要があるため、プロセスから切り離した cmd.exe に
     * 待ち時間つきで `sc start` を投げさせる (停止処理が終わる前に呼ぶと 1056 で失敗する)
     */
    private startWindowsService(): void {
        const name = getWindowsServiceName(process.env);
        // ping による待ち合わせ (サービス環境では timeout コマンドが使えないため)
        const command = `ping -n ${UpdateManageModel.SERVICE_START_WAIT_SEC} 127.0.0.1 > nul & sc start "${name}"`;
        this.log.system.info(`schedule windows service restart: ${name}`);
        const child = spawn('cmd.exe', ['/c', command], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();
    }

    /**
     * GitHub のリリース一覧を取得してキャッシュする
     */
    private async refresh(): Promise<void> {
        const repository = this.getRepository();
        const url = `https://api.github.com/repos/${repository}/releases?per_page=${UpdateManageModel.RELEASE_FETCH_LIMIT}`;
        try {
            const res = await this.http.get(url, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'EPGStation',
                },
                timeoutMs: 15000,
            });
            if (res.status !== 200) throw new Error(`unexpected status ${res.status}`);
            const releases = res.json<GitHubRelease[]>();
            if (Array.isArray(releases) === false) throw new Error('unexpected response');

            const published = releases.filter(x => x.draft !== true && typeof x.tag_name === 'string');
            this.latestStable = UpdateManageModel.pickLatest(published.filter(x => x.prerelease !== true));
            this.latestPrerelease = UpdateManageModel.pickLatest(published.filter(x => x.prerelease === true));
            this.checkedAt = Date.now();
            this.checkError = null;
        } catch (err: any) {
            // 取得失敗は致命的ではない (前回のキャッシュを使い続ける)
            this.checkError = err instanceof Error ? err.message : String(err);
            this.log.system.warn(`update check failed: ${this.checkError}`);
        }

        // 追従先ブランチの最新コミット (リリース前の修正を取り込みたい場合に使う)。
        // 失敗してもリリース情報の取得結果には影響させない
        await this.refreshBranch().catch(() => {});
    }

    /**
     * 追従先ブランチ (既定 main) の最新コミットを取得してキャッシュする
     */
    private async refreshBranch(): Promise<void> {
        const repository = this.getRepository();
        const branch = this.getBranch();
        try {
            const res = await this.http.get(
                `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`,
                {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28',
                        'User-Agent': 'EPGStation',
                    },
                    timeoutMs: 15000,
                },
            );
            if (res.status !== 200) throw new Error(`unexpected status ${res.status}`);
            const commit = res.json<GitHubCommit>();
            if (typeof commit?.sha !== 'string') throw new Error('unexpected response');
            const date = commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null;
            const parsed = date === null ? null : Date.parse(date);
            this.branchCommit = {
                sha: commit.sha,
                message: (commit.commit?.message ?? '').split('\n')[0].slice(0, 200),
                committedAt: parsed === null || Number.isNaN(parsed) ? null : parsed,
                htmlUrl: commit.html_url ?? `https://github.com/${repository}/commits/${branch}`,
            };
        } catch (err: any) {
            this.log.system.warn(`branch check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * リリース群から最も新しいものを選ぶ
     */
    private static pickLatest(releases: GitHubRelease[]): apid.UpdateReleaseInfo | null {
        let latest: GitHubRelease | null = null;
        for (const release of releases) {
            if (latest === null || compareVersions(latest.tag_name, release.tag_name) < 0) latest = release;
        }
        if (latest === null) return null;
        const publishedAt = latest.published_at === null ? null : Date.parse(latest.published_at);
        return {
            tag: latest.tag_name,
            name: latest.name ?? latest.tag_name,
            prerelease: latest.prerelease === true,
            publishedAt: publishedAt === null || Number.isNaN(publishedAt) ? null : publishedAt,
            htmlUrl: latest.html_url,
            body: (latest.body ?? '').slice(0, 4000),
        };
    }

    private buildStatus(): UpdateStatus {
        const currentVersion = this.getCurrentVersion();
        const installationType = this.getInstallationType();
        const supervisor = this.detectSupervisorType();

        // 通知対象は「正式リリース」と、プレリリースを含める設定なら「プレリリース」も見る
        const candidates: apid.UpdateReleaseInfo[] = [];
        if (this.latestStable !== null) candidates.push(this.latestStable);
        if (this.includePrerelease() === true && this.latestPrerelease !== null) {
            candidates.push(this.latestPrerelease);
        }
        let available: apid.UpdateReleaseInfo | null = null;
        for (const release of candidates) {
            if (isNewerVersion(currentVersion, release.tag) === false) continue;
            if (available === null || compareVersions(available.tag, release.tag) < 0) available = release;
        }

        const canUpdate = installationType === 'git';
        const updateNote = canUpdate
            ? `更新後、${describeRestart(supervisor)}`
            : 'git で取得したディレクトリではないため、ワンクリック更新は利用できません。配布アーカイブを展開し直すか、git clone した環境をご利用ください';

        return {
            currentVersion,
            currentIsPrerelease: isPrereleaseVersion(currentVersion),
            latestStable: this.latestStable,
            latestPrerelease: this.latestPrerelease,
            availableRelease: available,
            availableChannel: available === null ? null : available.prerelease === true ? 'prerelease' : 'stable',
            checkedAt: this.checkedAt,
            checkError: this.checkError,
            branch: this.buildBranchInfo(),
            currentCommit: this.getCurrentCommit(),
            installationType,
            supervisor,
            canUpdate,
            updateNote,
            // 更新を伴わない再起動は導入形態に依らず実行できるため、canUpdate とは別に説明を持たせる
            restartNote: describeRestart(supervisor),
            releasesUrl: `https://github.com/${this.getRepository()}/releases`,
            job: this.getJob(),
        };
    }

    /**
     * 現在のバージョン。
     * git 管理下ならチェックアウト中のタグを使う (package.json の version には
     * リリースタグの日付サフィックスが無く、自分自身より新しい版があるように見えてしまうため)
     */
    private getCurrentVersion(): string {
        if (this.currentVersion !== null) return this.currentVersion;
        // 画面右上のバージョン表記 (GET /api/version) と同じ値を使う
        this.currentVersion = getCurrentVersion();
        return this.currentVersion;
    }

    /**
     * 追従先ブランチの情報。ローカル HEAD と同じコミットなら upToDate になる
     */
    private buildBranchInfo(): apid.UpdateBranchInfo | null {
        if (this.branchCommit === null) return null;
        const current = this.getCurrentCommit();
        return {
            name: this.getBranch(),
            sha: this.branchCommit.sha,
            shortSha: this.branchCommit.sha.slice(0, 7),
            message: this.branchCommit.message,
            committedAt: this.branchCommit.committedAt,
            htmlUrl: this.branchCommit.htmlUrl,
            upToDate: current !== null && current === this.branchCommit.sha,
        };
    }

    /**
     * ローカルの HEAD コミット (git 管理下のときのみ)
     */
    private getCurrentCommit(): string | null {
        if (this.currentCommit !== null) return this.currentCommit;
        if (this.getInstallationType() !== 'git') return null;
        this.currentCommit = this.runCommandSync(
            resolveGitCommand(),
            buildGitArgs(UpdateManageModel.ROOT_PATH, ['rev-parse', 'HEAD']),
        );
        return this.currentCommit;
    }

    private getInstallationType(): InstallationType {
        if (this.installationType !== null) return this.installationType;
        this.installationType = fs.existsSync(path.join(UpdateManageModel.ROOT_PATH, '.git')) ? 'git' : 'archive';
        return this.installationType;
    }

    private detectSupervisorType(): SupervisorType {
        return detectSupervisor({
            env: process.env,
            platform: process.platform,
            hasDockerEnvFile: fs.existsSync('/.dockerenv'),
            // winser (nssm) 経由のサービスはセッション 0 で走り、対話的なコンソールを持たない
            isWindowsService: process.platform === 'win32' && process.stdout.isTTY !== true,
        });
    }

    private getRepository(): string {
        const value = this.config.getConfig().updateChecker?.repository;
        // 'owner/repo' 以外は URL の組み立てに使わせない
        return typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value)
            ? value
            : UpdateManageModel.DEFAULT_REPOSITORY;
    }

    /**
     * 追従先ブランチ名。git checkout に渡すため書式を検証する
     */
    private getBranch(): string {
        const value = this.config.getConfig().updateChecker?.branch;
        return typeof value === 'string' && /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/.test(value)
            ? value
            : UpdateManageModel.DEFAULT_BRANCH;
    }

    private getCheckIntervalMs(): number {
        const value = this.config.getConfig().updateChecker?.checkIntervalMs;
        return typeof value === 'number' && Number.isFinite(value)
            ? value
            : UpdateManageModel.DEFAULT_CHECK_INTERVAL_MS;
    }

    private includePrerelease(): boolean {
        // プレリリースは既定で通知する (UI 側で色を変えて区別する)
        return this.config.getConfig().updateChecker?.includePrerelease !== false;
    }

    private appendLog(level: apid.UpdateJobLogLine['level'], message: string): void {
        this.job.logs.push({ at: Date.now(), level, message });
        if (this.job.logs.length > UpdateManageModel.MAX_LOG_LINES) {
            this.job.logs.splice(0, this.job.logs.length - UpdateManageModel.MAX_LOG_LINES);
        }
    }

    private async runNpm(args: string[], cwd: string): Promise<string> {
        // Windows の npm は npm.cmd で、Node 20 以降は shell を介さないと spawn できない (EINVAL)。
        // 渡す引数は固定文字列だけなのでシェル経由でも解釈の余地は無い
        const npm = resolveNpmCommand();
        return await this.runCommand(npm.command, args, cwd, npm.shell);
    }

    /**
     * git を実行する。
     * Windows サービス (LocalSystem) から起動された場合に備え、実行ファイルの場所を解決し、
     * リポジトリの所有者チェック (dubious ownership) を回避する設定を都度渡す
     */
    private async runGit(args: string[], cwd: string): Promise<string> {
        return await this.runCommand(resolveGitCommand(), buildGitArgs(cwd, args), cwd);
    }

    /**
     * 外部コマンドを実行し、標準出力を返す。出力はジョブのログにも積む
     */
    private runCommand(command: string, args: string[], cwd: string, shell: boolean = false): Promise<string> {
        this.appendLog('command', `$ ${command} ${args.join(' ')}`);
        return new Promise<string>((resolve, reject) => {
            const child = spawn(command, args, {
                cwd,
                windowsHide: true,
                // 既定ではシェルを介さないことで、タグ名などがシェルに解釈される余地を無くす
                // (npm.cmd のようにシェルが必須なコマンドだけ呼び出し側で true を指定する)
                shell,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`CommandTimeout: ${command} ${args.join(' ')}`));
            }, UpdateManageModel.COMMAND_TIMEOUT_MS);

            child.stdout?.on('data', chunk => {
                stdout += chunk.toString();
                this.appendOutput(chunk.toString(), 'info');
            });
            child.stderr?.on('data', chunk => {
                stderr += chunk.toString();
                this.appendOutput(chunk.toString(), 'info');
            });
            child.once('error', err => {
                clearTimeout(timer);
                reject(new Error(`CommandFailed: ${command} (${err.message})`));
            });
            child.once('close', code => {
                clearTimeout(timer);
                if (code === 0) resolve(stdout);
                else {
                    const detail = (stderr || stdout).trim().split('\n').slice(-5).join(' / ');
                    reject(new Error(`CommandFailed: ${command} ${args.join(' ')} (exit ${code}) ${detail}`));
                }
            });
        });
    }

    private appendOutput(chunk: string, level: apid.UpdateJobLogLine['level']): void {
        for (const line of chunk.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed !== '') this.appendLog(level, trimmed);
        }
    }

    /**
     * バージョン判定用に短時間で終わるコマンドを同期実行する。失敗時は null
     */
    private runCommandSync(command: string, args: string[]): string | null {
        try {
            const { spawnSync } = require('child_process');
            const result = spawnSync(command, args, {
                cwd: UpdateManageModel.ROOT_PATH,
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
    }
}
