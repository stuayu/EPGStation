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

/**
 * `sc.exe qc <service>` の出力から、winser (nssm) が登録したサービスかどうかを判定する。
 * node-windows へ移行する際は先に旧サービスを削除してもらう必要があるため、
 * インストール時にこれで検出して案内する
 * @param queryOutput: string sc.exe qc の出力
 * @return boolean
 */
export const isNssmService = (queryOutput: string): boolean => /nssm(?:64)?\.exe/i.test(queryOutput);
