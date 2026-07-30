#!/usr/bin/env node
'use strict';

/**
 * EPGStation を Windows サービスとして登録 / 解除するスクリプト。
 *
 *   node scripts/win-service.js install    サービスを登録する
 *   node scripts/win-service.js uninstall  サービスを削除する
 *   node scripts/win-service.js status     登録状況と、サービスから見た実行環境を表示する
 *
 * オプション (install のみ):
 *   --user=<アカウント>      サービスの実行アカウント (既定はログオン中のユーザー)
 *   --password=<パスワード>  省略時は対話で入力を求める (入力は伏せ字になる)
 *   --system                 LocalSystem として動かす (パスワードを持たないアカウント向け)
 *
 * 全サブコマンド共通:
 *   --name=<表示名>          サービスの表示名 (既定は EPGStation)。1 台で複数の
 *                            EPGStation を動かす場合に使う。uninstall / status でも
 *                            同じ --name を渡すこと
 *
 * node-windows は「グローバルインストール + npm link」で使う。
 *   > npm install -g node-windows
 *   > npm link node-windows
 * link していない場合はグローバルの node_modules から読み込む (それも無ければ案内して終了する)
 *
 * 既定ではログオン中のユーザーアカウントでサービスを動かす。LocalSystem だと
 * 録画先のネットワーク共有 (UNC パス) や、ユーザー環境に置いた設定・実行ファイルへ
 * 手が届かず、git もリポジトリの所有者と一致しないため扱いづらい。
 *
 * サービスは既定で LocalSystem・セッション 0 で動くため、そのままでは
 * ユーザースコープの PATH を参照できず、git / ffmpeg / tsreadex が見つからない。
 * また EPGStation のディレクトリの所有者と実行アカウントが異なるため、
 * git が dubious ownership で失敗しワンクリック更新が動かない。
 * そこで登録時に次を設定する。
 *
 *   1. サービス専用の環境変数 Path (node / git / config.yml のツールのディレクトリを追加)
 *   2. git config --system --add safe.directory <EPGStation のパス>
 *   3. 更新後の再起動方法を確定させる環境変数
 *
 * node-windows は winsw (サービスラッパ) + wrapper.js (node の親プロセス) 構成で、
 * 子プロセスが終了すると自動で起動し直す。このためワンクリック更新の
 * 「プロセスを終了して入れ替わる」方式がそのまま機能する
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const distPath = path.join(root, 'dist', 'index.js');

// ビルド済みの純粋関数を使う (テストは test/ut/windows-service.test.js)
const {
    SERVICE_DISPLAY_NAME,
    buildServiceEnvironment,
    collectToolDirectories,
    defaultServiceAccountName,
    isNssmService,
    parseServiceAccount,
    toServiceId,
} = require(path.join(root, 'dist', 'util', 'WindowsService'));

// --name で上書きできるようにするため、実行時に決める (既定は EPGStation)
let displayName = SERVICE_DISPLAY_NAME;
let serviceName = toServiceId(displayName);

/**
 * --name の指定を反映する
 */
const applyServiceName = options => {
    if (typeof options.name !== 'string' || options.name.trim() === '') return;
    displayName = options.name.trim();
    serviceName = toServiceId(displayName);
    if (serviceName === '') {
        throw new Error('--name には英数字を含む名前を指定してください');
    }
};

/**
 * node-windows を読み込む。
 * ローカルに無い場合はグローバルインストール (npm install -g node-windows) を探す。
 * node-windows は winsw の実行ファイルを同梱するため、環境によっては
 * グローバルへ入れて npm link したものでないと動かない
 */
const requireNodeWindows = () => {
    try {
        return require('node-windows');
    } catch (err) {
        // グローバルの node_modules を探す
        const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true, shell: true });
        const globalRoot = typeof result.stdout === 'string' ? result.stdout.trim() : '';
        if (globalRoot !== '') {
            try {
                return require(path.join(globalRoot, 'node-windows'));
            } catch (globalErr) {
                // 見つからなかった場合は下の案内へ
            }
        }
        throw new Error(
            'node-windows を読み込めませんでした。次のコマンドを実行してから再度お試しください:\n' +
                '  npm install -g node-windows\n' +
                '  npm link node-windows',
        );
    }
};

const log = message => console.log(message);
const warn = message => console.warn(`[warn] ${message}`);

/**
 * 引数を { command, options } に分解する
 */
const parseArgs = argv => {
    const options = {};
    let command = null;
    for (const arg of argv) {
        const matched = arg.match(/^--([^=]+)(?:=(.*))?$/);
        if (matched === null) {
            if (command === null) command = arg;
            continue;
        }
        options[matched[1]] = matched[2] ?? true;
    }
    return { command, options };
};

/**
 * 管理者権限で動いているか (net session は管理者以外では失敗する)
 */
const isAdministrator = () => {
    const result = spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' });
    return result.error === undefined && result.status === 0;
};

/**
 * コマンドの実体があるディレクトリ (見つからない場合は null)
 */
const findCommandDirectory = name => {
    const result = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
    if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') return null;
    const first = result.stdout.split(/\r?\n/).find(line => line.trim() !== '');
    return typeof first === 'string' ? path.dirname(first.trim()) : null;
};

/**
 * サービスへ渡す環境変数を組み立てる
 */
const createEnvironment = () => {
    const extraDirectories = [];
    // node と git はユーザースコープの PATH にしか入っていないことがある
    for (const command of ['node', 'git']) {
        const directory = findCommandDirectory(command);
        if (directory !== null) extraDirectories.push(directory);
        else if (command === 'git') {
            warn('git が見つかりません。ワンクリック更新を使う場合は Git for Windows を「すべてのユーザー」向けにインストールしてください');
        }
    }
    // config.yml に絶対パスで書かれた ffmpeg / tsreadex 等
    const configPath = path.join(root, 'config', 'config.yml');
    if (fs.existsSync(configPath) === true) {
        extraDirectories.push(...collectToolDirectories(fs.readFileSync(configPath, 'utf8')));
    }

    return buildServiceEnvironment({
        machinePath: process.env.Path ?? process.env.PATH ?? '',
        extraDirectories,
        serviceName,
    });
};

/**
 * git の safe.directory をシステム全体に登録する。
 * リポジトリの所有者とサービスの実行アカウントが異なると git が全コマンド失敗するため
 */
const registerSafeDirectory = () => {
    // git の設定値はパス区切りに / を使う
    const gitRoot = root.replace(/\\/g, '/');
    try {
        const registered = execFileSync('git', ['config', '--system', '--get-all', 'safe.directory'], {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (registered.split(/\r?\n/).includes(gitRoot) === true) {
            log(`git の safe.directory は既に登録済みです: ${gitRoot}`);
            return;
        }
    } catch (err) {
        // 1 件も登録されていない場合は exit 1 になるため、この失敗は無視して追加へ進む
    }

    try {
        execFileSync('git', ['config', '--system', '--add', 'safe.directory', gitRoot], { windowsHide: true });
        log(`git の safe.directory に追加しました: ${gitRoot}`);
    } catch (err) {
        warn(`git の safe.directory を登録できませんでした: ${err.message}`);
    }
};

const unregisterSafeDirectory = () => {
    const gitRoot = root.replace(/\\/g, '/');
    try {
        // 値を正規表現として解釈させないため --fixed-value を使う
        execFileSync('git', ['config', '--system', '--unset-all', '--fixed-value', 'safe.directory', gitRoot], {
            windowsHide: true,
            stdio: 'ignore',
        });
        log(`git の safe.directory から削除しました: ${gitRoot}`);
    } catch (err) {
        // 未登録の場合も exit 5 になるため無視する
    }
};

/**
 * sc.exe qc の出力を取る (サービスが無い場合は null)
 */
const queryService = () => {
    const result = spawnSync('sc.exe', ['qc', serviceName], { encoding: 'utf8', windowsHide: true });
    if (result.error !== undefined || result.status !== 0) return null;
    return typeof result.stdout === 'string' ? result.stdout : null;
};

/**
 * 文字を伏せ字にしてパスワードを読み取る。
 * 入力されたパスワードは Windows のサービス設定へ渡す以外の用途には使わない
 */
const readPassword = async account => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const query = `${account} のパスワードを入力してください: `;

    // readline が入力をそのまま表示しないよう差し替える
    rl._writeToOutput = value => {
        if (value.includes(query) === true) rl.output.write(query);
        else if (value === '\r\n' || value === '\n') rl.output.write(value);
        else rl.output.write('*');
    };

    try {
        const password = await new Promise(resolve => rl.question(query, resolve));
        process.stdout.write('\n');

        return password;
    } finally {
        rl.close();
    }
};

const readLine = async query => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await new Promise(resolve => rl.question(query, resolve));
    } finally {
        rl.close();
    }
};

/**
 * サービスの実行アカウントを決める。
 * 既定はログオン中のユーザー。--system が指定された場合のみ LocalSystem にする
 */
const resolveLogOnAccount = async options => {
    if (options.system === true) return null;

    const computerName = process.env.COMPUTERNAME ?? '.';
    const specified = typeof options.user === 'string' && options.user !== '' ? options.user : null;
    const fallback = defaultServiceAccountName(process.env);

    let input = specified;
    if (input === null) {
        // 既定を提示しつつ、別アカウントで動かしたい場合は入力してもらう
        const answer = await readLine(`サービスの実行ユーザー名 [${fallback}]: `);
        input = answer.trim() === '' ? fallback : answer;
    }

    const account = parseServiceAccount(input, computerName);
    if (account === null) {
        throw new Error('サービスの実行ユーザー名を判別できませんでした。--user で指定するか --system を使用してください');
    }

    const password =
        typeof options.password === 'string' ? options.password : await readPassword(`${account.domain}\\${account.account}`);
    if (password === '') {
        throw new Error(
            'パスワードが空です。Microsoft アカウントでサインインしている場合は、ローカルアカウントに切り替えてパスワードを設定してから実行してください ' +
                '(LocalSystem で動かす場合は --system を付けてください)',
        );
    }

    return { domain: account.domain, account: account.account, password: password };
};

/**
 * サービスの定義を作る
 * @param logOnAccount 実行アカウント (null なら LocalSystem)
 */
const createService = (logOnAccount = null) => {
    // node-windows は Windows 以外では読み込めないためここで require する
    const { Service } = requireNodeWindows();

    const svc = new Service({
        name: displayName,
        description: 'EPGStation (DTV recording manager)',
        script: distPath,
        workingDirectory: root,
        env: createEnvironment(),
        // 落ちたときに起こし直す。1 回目は 2 秒待ち、以降 1.5 倍ずつ延ばす
        wait: 2,
        grow: 0.5,
        maxRestarts: 10,
        // 意図的な終了 (ワンクリック更新) でも起こし直させるため中断させない
        abortOnError: false,
        // 指定したアカウントに「サービスとしてログオン」権限を付与させる
        allowServiceLogon: logOnAccount !== null,
    });

    // winsw の実行ファイルと設定の置き場所。
    // 既定では script のディレクトリ (dist) の下に daemon が作られるが、そこへ置くと
    // ビルド時の dist 削除が実行中のサービス本体に当たって EPERM になる
    svc.directory(root);

    if (logOnAccount !== null) {
        svc.logOnAs.domain = logOnAccount.domain;
        svc.logOnAs.account = logOnAccount.account;
        svc.logOnAs.password = logOnAccount.password;
        // 登録後に設定ファイルからパスワードを消す (node-windows の既定動作)
        svc.logOnAs.mungeCredentialsAfterInstall = true;
    }

    return svc;
};

const install = async options => {
    if (fs.existsSync(distPath) === false) {
        throw new Error('dist/index.js がありません。先に "npm run build-win" を実行してください');
    }

    const existing = queryService();
    if (existing !== null) {
        if (isNssmService(existing) === true) {
            throw new Error(
                `winser (nssm) で登録されたサービス ${serviceName} が残っています。` +
                    '"npm install winser -g" した環境で "winser -r -x" を実行して削除してから、もう一度実行してください',
            );
        }
        throw new Error(`サービス ${serviceName} は既に登録されています。先に "npm run uninstall-win-service" を実行してください`);
    }

    // 以前のバージョンは dist/daemon にサービス本体を置いていた。
    // 残っているとビルド時の dist 削除で EPERM になるため案内する
    const legacyDaemonPath = path.join(root, 'dist', 'daemon');
    if (fs.existsSync(legacyDaemonPath) === true) {
        warn(`古いサービスの残骸が残っています: ${legacyDaemonPath}`);
        warn('サービスを削除した後もこのディレクトリが残る場合は手動で削除してください');
    }

    const logOnAccount = await resolveLogOnAccount(options);

    const svc = createService(logOnAccount);
    svc.on('install', () => {
        log(
            logOnAccount === null
                ? `サービスを登録しました: ${serviceName} (LocalSystem)`
                : `サービスを登録しました: ${serviceName} (${logOnAccount.domain}\\${logOnAccount.account})`,
        );
        registerSafeDirectory();
        if (logOnAccount !== null) {
            log('録画先・ログ出力先のディレクトリに、このアカウントの書き込み権限があることを確認してください');
        }
        log('');
        log('次のコマンドで起動できます:');
        log(`  net start ${serviceName}`);
    });
    svc.on('alreadyinstalled', () => warn(`サービス ${serviceName} は既に登録されています`));
    svc.on('invalidinstallation', () => warn('サービスの登録に失敗しました (インストールが不完全です)'));

    for (const entry of createEnvironment()) {
        if (entry.name === 'Path') continue;
        log(`サービスの環境変数: ${entry.name}=${entry.value}`);
    }
    svc.install();
};

const uninstall = () => {
    const svc = createService();
    svc.on('uninstall', () => {
        log(`サービスを削除しました: ${serviceName}`);
        unregisterSafeDirectory();
    });
    // node-windows が未登録時に出すイベント名は alreadyuninstalled
    svc.on('alreadyuninstalled', () => warn(`サービス ${serviceName} は登録されていません`));
    svc.uninstall();
};

const status = () => {
    const existing = queryService();
    log(`EPGStation のディレクトリ: ${root}`);
    log(`表示名: ${displayName}`);
    log(`サービス名: ${serviceName}`);
    if (existing === null) {
        log('登録状況: 未登録');
    } else {
        log(`登録状況: 登録済み${isNssmService(existing) === true ? ' (winser / nssm 由来)' : ' (node-windows)'}`);
        // 実行アカウントは sc.exe qc の SERVICE_START_NAME に出る
        const startName = existing.split(/\r?\n/).find(line => line.includes('SERVICE_START_NAME'));
        if (typeof startName === 'string') log(`実行アカウント: ${startName.split(':').slice(1).join(':').trim()}`);
    }
    for (const command of ['node', 'git']) {
        const directory = findCommandDirectory(command);
        log(`${command}: ${directory === null ? '見つかりません' : path.join(directory, command)}`);
    }
    for (const entry of createEnvironment()) {
        log(`${entry.name}=${entry.value}`);
    }
};

const main = async () => {
    if (process.platform !== 'win32') {
        throw new Error('このスクリプトは Windows でのみ使用できます');
    }

    const { command, options } = parseArgs(process.argv.slice(2));
    // --name は全サブコマンド共通 (別名で登録したサービスを解除・確認できるようにする)
    applyServiceName(options);
    if (command !== 'status' && isAdministrator() === false) {
        throw new Error('管理者権限で実行してください (コマンドプロンプトを「管理者として実行」)');
    }

    switch (command) {
        case 'install':
            await install(options);
            break;
        case 'uninstall':
            uninstall();
            break;
        case 'status':
            status();
            break;
        default:
            throw new Error('使い方: node scripts/win-service.js <install|uninstall|status> [--name=<表示名>]');
    }
};

main().catch(err => {
    console.error(`[error] ${err.message}`);
    process.exitCode = 1;
});
