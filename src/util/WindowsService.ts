/**
 * Windows サービス登録 (`scripts/win-service.js`) が使う純粋関数。
 *
 * サービスは既定で LocalSystem・セッション 0 で動くため、ユーザースコープの PATH を
 * 参照できない。git / node / ffmpeg 等が見つからず、ワンクリック更新もエンコードも
 * 動かなくなるため、サービス専用の環境変数を組み立てて登録時に渡す。
 * 判定ロジックをここに置いてテストから確認できるようにしている
 * (登録処理そのものは node-windows と sc.exe を叩くため scripts 側に置く)
 */

/**
 * サービスの表示名。node-windows はこれを正規化した文字列 (英数字のみ・小文字) を
 * サービス名として使うため、`EPGStation` から `epgstation` になる
 * (winser 時代と同じサービス名なので `net start epgstation` がそのまま使える)
 */
export const SERVICE_DISPLAY_NAME = 'EPGStation';

/**
 * 表示名から node-windows が作るサービス名 (= `svc.id`) を求める
 * @param displayName: string
 * @return string
 */
export const toServiceId = (displayName: string): string => displayName.replace(/[^\w]/gi, '').toLowerCase();

/**
 * config.yml から実行ファイルのディレクトリを集める対象のキー
 */
const TOOL_KEYS = ['ffmpeg', 'ffprobe', 'tsreadex', 'qsvencc', 'nvencc', 'vceencc'] as const;

/**
 * config.yml に絶対パスで書かれた実行ファイルのディレクトリを集める。
 * PATH 上のコマンド名だけを書いている場合 (`ffmpeg` 等) は対象外
 * @param configText: string config.yml の内容
 * @return string[] 重複を除いたディレクトリの一覧 (登場順)
 */
export const collectToolDirectories = (configText: string): string[] => {
    const result: string[] = [];
    for (const line of configText.split(/\r?\n/)) {
        const matched = line.match(new RegExp(`^\\s*(${TOOL_KEYS.join('|')})\\s*:\\s*(.+?)\\s*$`));
        if (matched === null) continue;

        // 引用符とコメントを落とす
        const value = matched[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
        if (value === '' || /[\\/]/.test(value) === false) continue;

        const directory = value.replace(/[\\/][^\\/]*$/, '');
        if (directory !== '' && result.includes(directory) === false) result.push(directory);
    }
    return result;
};

/**
 * 末尾の区切り文字を落として比較しやすくする
 */
const normalizeDirectory = (value: string): string => value.replace(/[\\/]+$/, '');

/**
 * サービスへ渡す PATH を組み立てる。
 * マシン全体の PATH を土台に、ユーザースコープにしか無いことが多いディレクトリ
 * (node / git / エンコーダ) を後ろへ追加する
 * @param machinePath: string マシン全体の PATH
 * @param extraDirectories: string[] 追加するディレクトリ
 * @return string
 */
export const buildServicePath = (machinePath: string, extraDirectories: string[]): string => {
    const entries: string[] = [];
    for (const entry of machinePath.split(';')) {
        const normalized = normalizeDirectory(entry.trim());
        if (normalized !== '' && entries.includes(normalized) === false) entries.push(normalized);
    }
    for (const directory of extraDirectories) {
        const normalized = normalizeDirectory((directory ?? '').trim());
        if (normalized !== '' && entries.includes(normalized) === false) entries.push(normalized);
    }
    return entries.join(';');
};

export interface ServiceEnvironmentInput {
    machinePath: string;
    // node / git / エンコーダなど PATH に足したいディレクトリ
    extraDirectories: string[];
    serviceName: string;
}

export interface ServiceEnvironmentEntry {
    name: string;
    value: string;
}

/**
 * サービスへ渡す環境変数を組み立てる
 * @param input: ServiceEnvironmentInput
 * @return ServiceEnvironmentEntry[]
 */
export const buildServiceEnvironment = (input: ServiceEnvironmentInput): ServiceEnvironmentEntry[] => [
    { name: 'Path', value: buildServicePath(input.machinePath, input.extraDirectories) },
    // 更新後の再起動方法を自動判定に任せず確定させる (src/model/update/UpdateEnvironment.ts)
    { name: 'EPGSTATION_SERVICE_MANAGER', value: 'windows-service' },
    { name: 'EPGSTATION_WIN_SERVICE_NAME', value: input.serviceName },
];

export interface ServiceAccount {
    domain: string;
    account: string;
}

/**
 * サービスの実行アカウント指定を domain / account へ分解する。
 * `DOMAIN\user` / `.\user` / `user` の 3 形式を受け付け、ドメイン名の無い指定 (`.` を含む)
 * はローカルコンピュータ名を使う
 * @param input: string 入力された指定
 * @param computerName: string ローカルコンピュータ名
 * @return ServiceAccount | null 空文字列の場合は null
 */
export const parseServiceAccount = (input: string, computerName: string): ServiceAccount | null => {
    const trimmed = (input ?? '').trim();
    if (trimmed === '') return null;

    const separator = trimmed.lastIndexOf('\\');
    if (separator === -1) return { domain: computerName, account: trimmed };

    const domain = trimmed.slice(0, separator);
    const account = trimmed.slice(separator + 1);
    if (account === '') return null;

    return { domain: domain === '' || domain === '.' ? computerName : domain, account: account };
};

/**
 * 既定の実行アカウント (サービスを登録しようとしているユーザー) を求める。
 * EPGStation は録画先ディレクトリやチューナーへユーザー権限でアクセスできる方が扱いやすいため、
 * LocalSystem ではなくログオン中のユーザーを既定にする
 * @param env: Record<string, string | undefined>
 * @return string `DOMAIN\user` 形式。求められない場合は空文字列
 */
export const defaultServiceAccountName = (env: Record<string, string | undefined>): string => {
    const account = env.USERNAME ?? '';
    if (account === '') return '';

    const domain = env.USERDOMAIN ?? env.COMPUTERNAME ?? '';

    return domain === '' ? account : `${domain}\\${account}`;
};

/**
 * `sc.exe qc <service>` の出力から、winser (nssm) が登録したサービスかどうかを判定する。
 * node-windows へ移行する際は先に旧サービスを削除してもらう必要があるため、
 * インストール時にこれで検出して案内する
 * @param queryOutput: string sc.exe qc の出力
 * @return boolean
 */
export const isNssmService = (queryOutput: string): boolean => /nssm(?:64)?\.exe/i.test(queryOutput);
