/**
 * 実行環境の判定。
 * 「どのプラットフォーム・どのサービス管理下でもワンクリック更新できる」ようにするため、
 * 更新後の再起動方法を実行環境から決める。
 * ここは環境変数などの入力を受け取る純粋関数にして、テストから全分岐を確認できるようにしている
 */

/**
 * EPGStation を監視・自動再起動している仕組み。
 * 'none' の場合はプロセスを終了しても誰も起こしてくれないため、自分で後継プロセスを起動する必要がある
 */
export type SupervisorType = 'docker' | 'systemd' | 'pm2' | 'windows-service' | 'none';

/**
 * 導入形態。'git': リポジトリを clone したもの (更新可能) / 'archive': 配布アーカイブを展開したもの
 */
export type InstallationType = 'git' | 'archive';

export interface SupervisorInput {
    env: Record<string, string | undefined>;
    platform: string;
    // /.dockerenv の有無 (呼び出し側で確認した結果)
    hasDockerEnvFile: boolean;
    // Windows でサービスとして起動されているとみなせるか (呼び出し側で確認した結果)
    isWindowsService: boolean;
}

/**
 * EPGStation を監視しているプロセス管理の種類を判定する
 * @param input: SupervisorInput
 * @return SupervisorType
 */
export const detectSupervisor = (input: SupervisorInput): SupervisorType => {
    const env = input.env ?? {};

    // Docker はコンテナの restart policy が再起動を担う
    if (input.hasDockerEnvFile === true || env.container === 'docker' || env.EPGSTATION_IN_DOCKER === '1') {
        return 'docker';
    }
    // pm2 は起動したプロセスに pm_id を渡す
    if (typeof env.pm_id !== 'undefined' || typeof env.PM2_HOME !== 'undefined') {
        return 'pm2';
    }
    // systemd はサービスとして起動したプロセスに INVOCATION_ID / JOURNAL_STREAM を渡す
    if (typeof env.INVOCATION_ID !== 'undefined' || typeof env.JOURNAL_STREAM !== 'undefined') {
        return 'systemd';
    }
    if (input.platform === 'win32' && input.isWindowsService === true) {
        return 'windows-service';
    }
    return 'none';
};

/**
 * プロセスを終了させれば監視側が新しいコードで起こし直してくれるか。
 * false の場合は後継プロセスを自前で spawn してから終了する必要がある
 * @param supervisor: SupervisorType
 * @return boolean
 */
export const canSupervisorRestart = (supervisor: SupervisorType): boolean => supervisor !== 'none';

/**
 * 再起動の挙動をユーザーへ説明する文言 (UI に出して「更新後に上がってこない」事故を防ぐ)
 * @param supervisor: SupervisorType
 * @return string
 */
export const describeRestart = (supervisor: SupervisorType): string => {
    switch (supervisor) {
        case 'docker':
            return 'Docker コンテナの restart policy により再起動されます (restart: always などの指定が必要です)';
        case 'systemd':
            return 'systemd により再起動されます (ユニットに Restart=always の指定が必要です)';
        case 'pm2':
            return 'pm2 により再起動されます';
        case 'windows-service':
            return 'Windows サービスの回復設定により再起動されます';
        default:
            return 'サービス管理が検出できなかったため、EPGStation 自身が後継プロセスを起動してから終了します';
    }
};
