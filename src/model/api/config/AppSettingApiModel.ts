import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import IAppSettingHistoryDB from '../../db/IAppSettingHistoryDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IConfigOverlayLoader from '../../config/IConfigOverlayLoader';
import { configOverlayRequiresRestart, diffConfigOverlayKeys, sanitizeConfigOverlay } from '../../config/ConfigOverlay';
import {
    CONFIG_SCHEMA,
    YML_ONLY_REASON_CATEGORY,
    YML_ONLY_REASONS,
    YmlOnlyReasonCode,
} from '../../config/ConfigSchema';
import ILogLevelApplier from '../../log/ILogLevelApplier';
import ISecretCrypto from '../../security/ISecretCrypto';
import { appSettingRequiresRestart, APP_SETTING_ALLOWED_KEYS, validateAppSettingValue } from './AppSettingSchema';
import IAppSettingApiModel, {
    AppSettingHistoryItem,
    AppSettingUpdateResult,
    EditableConfig,
} from './IAppSettingApiModel';

export function validateAppSettings(value: unknown): asserts value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('AppSettingsMustBeObject');
    }
    for (const key of Object.keys(value)) {
        if (!APP_SETTING_ALLOWED_KEYS.has(key)) throw new Error(`UnknownAppSetting:${key}`);
    }
}

type TransformMode = 'encrypt' | 'mask';
// config.yml 側の各項目 (トップレベルキー・入力欄の path) が既定値 / config.yml / GUI の差分の
// どれで決まっているかを示す出所判定結果
type ConfigProvenance = 'default' | 'file' | 'overlay';

// ConfigSchema の fields[].path のうち secret: true が付いている path の集合。
// maskConfig() のマスク対象の 1 系統として使う (ConfigSchema を定義元とする、§指摘6)
const CONFIG_SCHEMA_SECRET_PATHS: ReadonlySet<string> = new Set(
    CONFIG_SCHEMA.flatMap(entry =>
        (entry.fields ?? []).filter(field => field.secret === true).map(field => field.path),
    ),
);

@injectable()
export default class AppSettingApiModel implements IAppSettingApiModel {
    // トップレベル・ネスト問わずどこにあっても秘密情報として扱うキー
    private static readonly SECRET_KEYS = new Set(['token', 'apiKey', 'secret', 'password']);
    // notifications.targets 配下でのみ url も秘密情報として扱う (Discord Webhook URL 等、§7.3)
    private static readonly TARGET_SECRET_KEYS = new Set(['token', 'apiKey', 'secret', 'password', 'url']);
    // config.yml 側 (maskConfig) のキー名ベースの汎用マスク対象。
    // ConfigSchema に fields を持たない ymlOnly 項目 (auth / mysql / postgres 等) は
    // ネストの中身までスキーマに無いため、キー名ベースでの判定が必要 (§指摘6)
    private static readonly CONFIG_SECRET_KEY_NAMES = new Set([
        'token',
        'apiKey',
        'secret',
        'password',
        'clientSecret',
    ]);
    // 復号できなかった値 (secretKey 未設定・鍵ローテーション後など) を示すプレースホルダ。
    // 実際の暗号文はそのまま DB に残るため、これを再度 PUT しても上書きされない限りデータは失われない
    private static readonly UNDECRYPTABLE_PLACEHOLDER = '********(復号不可)';
    // config.yml 側の秘密情報を画面へ出すときの伏せ字。この値のまま保存されたら変更なしとして扱う
    public static readonly CONFIG_SECRET_PLACEHOLDER = '********';

    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IAppSettingDB') private readonly db: IAppSettingDB,
        @inject('ISecretCrypto') private readonly crypto: ISecretCrypto,
        @inject('IAppSettingHistoryDB') private readonly history: IAppSettingHistoryDB,
        @inject('IIPCClient') private readonly ipc: IIPCClient,
        @inject('ILogLevelApplier') private readonly logLevelApplier: ILogLevelApplier,
        @inject('IConfigOverlayLoader') private readonly configOverlayLoader: IConfigOverlayLoader,
    ) {}

    /**
     * マスク・復号適用済みの設定値一式を取得する。
     * secretKey が未設定、または鍵ローテーション後で既存の暗号文が復号できない場合でも、
     * 該当項目だけを「復号不可」プレースホルダに差し替えて返し、画面自体は開けるようにする (§6.6)
     */
    public async get(): Promise<Record<string, unknown>> {
        this.ensureEnabled();
        return this.transformSecrets(await this.db.getAll(), null, 'mask') as Record<string, unknown>;
    }

    /**
     * config.yml 編集画面用の情報を返す。
     * 秘密情報 (トークン・パスワード等) は含めない形にマスクしてから返す
     */
    public async getEditableConfig(): Promise<EditableConfig> {
        this.ensureEnabled();
        // 出所判定はサーバー側で確定させ、クライアントには判定済みの結果だけを渡す (§指摘5)
        const overlay = this.configuration.getOverlay();
        const rawFileConfig = this.configuration.getRawFileConfig();
        return {
            effective: this.maskConfig(this.configuration.getConfig() as unknown as Record<string, unknown>),
            file: this.maskConfig(this.configuration.getFileConfig() as unknown as Record<string, unknown>),
            overlay: this.maskConfig(overlay),
            provenance: this.buildProvenance(overlay, rawFileConfig),
            fields: CONFIG_SCHEMA.map(entry => ({
                key: entry.key as string,
                label: entry.label,
                hint: entry.hint,
                requiresRestart: entry.requiresRestart,
                editable: entry.editable,
                reason:
                    entry.editable === 'ymlOnly' && typeof entry.reason !== 'undefined'
                        ? YML_ONLY_REASONS[entry.reason as YmlOnlyReasonCode]
                        : undefined,
                reasonCategory:
                    entry.editable === 'ymlOnly' && typeof entry.reason !== 'undefined'
                        ? YML_ONLY_REASON_CATEGORY[entry.reason as YmlOnlyReasonCode]
                        : undefined,
                fields: entry.fields,
                customEditor: entry.customEditor,
            })),
        };
    }

    /**
     * CONFIG_SCHEMA の全項目 (トップレベルキーと、その配下の入力欄の path) について、
     * 実効値が既定値 / config.yml / GUI の差分のどこで決まっているかを判定する。
     * 判定基準は「overlay にあれば overlay、生の config.yml (既定値補完前) にあれば file、
     * どちらにも無ければ default」(旧クライアント側 provenanceOfPath() と同じ基準)
     */
    private buildProvenance(
        overlay: Record<string, unknown>,
        rawFileConfig: Record<string, unknown>,
    ): Record<string, ConfigProvenance> {
        const provenance: Record<string, ConfigProvenance> = {};
        const resolve = (path: string): ConfigProvenance => {
            if (typeof AppSettingApiModel.pickByPath(overlay, path) !== 'undefined') return 'overlay';
            if (typeof AppSettingApiModel.pickByPath(rawFileConfig, path) !== 'undefined') return 'file';
            return 'default';
        };
        for (const entry of CONFIG_SCHEMA) {
            const key = entry.key as string;
            provenance[key] = resolve(key);
            for (const field of entry.fields ?? []) {
                provenance[field.path] = resolve(field.path);
            }
        }
        return provenance;
    }

    /**
     * 'a.b.c' 形式のパスで値を取り出す (存在しなければ undefined)
     */
    private static pickByPath(source: Record<string, unknown>, path: string): unknown {
        return path.split('.').reduce<unknown>((acc, key) => {
            if (acc === null || typeof acc !== 'object') return undefined;
            return (acc as Record<string, unknown>)[key];
        }, source);
    }

    /**
     * config の中の秘密情報を伏せる。
     * config.yml は管理者が直接読めるファイルだが、画面へ出す以上は不要な露出を避ける。
     * マスク対象は次の和集合 (§指摘6):
     *   - ConfigSchema の fields[].secret === true が付いた path (schema を定義元として使う)
     *   - キー名ベースの汎用マスク (token / apiKey / secret / password / clientSecret)。
     *     ConfigSchema に fields を持たない ymlOnly 項目 (auth / mysql / postgres 等) は
     *     ネストの中身までスキーマに無いため、キー名ベースでの判定が必要
     *   - notifications.targets[] 配下の url (Discord Webhook URL 等)
     */
    private maskConfig(value: Record<string, unknown>): Record<string, unknown> {
        return this.maskConfigValue(value ?? {}, '') as Record<string, unknown>;
    }

    private maskConfigValue(value: unknown, path: string): unknown {
        if (Array.isArray(value)) {
            // 配列はインデックスをパスに含めない (notifications.targets[].url のような
            // 「配下のどの要素でも同じキーは同じ扱い」を単純に表現するため)
            return value.map(item => this.maskConfigValue(item, path));
        }
        if (typeof value === 'object' && value !== null) {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
                    childKey,
                    this.maskConfigValue(child, path === '' ? childKey : `${path}.${childKey}`),
                ]),
            );
        }
        if (typeof value !== 'string' || value === '') return value;
        return this.isConfigSecretPath(path) ? AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER : value;
    }

    private isConfigSecretPath(path: string): boolean {
        if (CONFIG_SCHEMA_SECRET_PATHS.has(path)) return true;
        const lastDot = path.lastIndexOf('.');
        const key = lastDot === -1 ? path : path.slice(lastDot + 1);
        const parentPath = lastDot === -1 ? '' : path.slice(0, lastDot);
        if (parentPath === 'notifications.targets' && key === 'url') return true;
        return AppSettingApiModel.CONFIG_SECRET_KEY_NAMES.has(key);
    }

    /**
     * 設定値を更新する。JSON Schema 検証・シークレットの暗号化・変更履歴の記録・
     * requiresRestart 判定をまとめて行う
     * @param value: トップレベルキーごとの更新内容 (部分更新可)
     */
    public async update(value: Record<string, unknown>): Promise<AppSettingUpdateResult> {
        this.ensureEnabled();
        validateAppSettings(value);
        for (const [key, v] of Object.entries(value)) {
            validateAppSettingValue(key, v);
        }
        // config.yml への重ね書きは編集を許可したキーだけに絞る
        if (typeof value.config !== 'undefined') {
            const overlay = sanitizeConfigOverlay(value.config);
            // 伏せ字 (maskConfig() が返した値) のまま送り返された項目は「変更なし」とみなし、
            // 既存の秘密情報が伏せ字で上書きされる事故を防ぐため全て取り除く (§指摘6の汎用化)
            const withoutMaskedPlaceholders = AppSettingApiModel.stripMaskedPlaceholders(overlay) as Record<
                string,
                unknown
            >;
            // config.yml の値と厳密に同じ (leaf 単位) になった項目は、差分として残さず落とす。
            // 一度触って元の値に戻した項目が差分として永久に残ってしまうのを防ぐ (§指摘7)。
            // 配列項目 (recorded / encode / stream 等) は「丸ごと置き換え」の単位のため
            // leaf 単位には分解せず、配列全体が config.yml と同じ場合にのみ落とす
            value.config = AppSettingApiModel.pruneLeavesEqualToFileConfig(
                withoutMaskedPlaceholders,
                this.configuration.getFileConfig() as unknown as Record<string, unknown>,
            );
        }

        const current = await this.db.getAll();
        let protectedValues: Record<string, unknown>;
        try {
            protectedValues = this.transformSecrets(value, current, 'encrypt') as Record<string, unknown>;
        } catch (e: any) {
            if (typeof e?.message === 'string' && e.message.includes('SecretKeyIsNotConfigured')) {
                throw new Error('AppSettingSecretKeyIsNotConfigured');
            }
            throw e;
        }

        const now = Date.now();
        for (const key of Object.keys(protectedValues)) {
            await this.history.add(key, current[key] ?? null, now);
        }

        await this.db.upsert(protectedValues);

        // Operator プロセスへホットリロードを通知する (§6.3)。録画中の処理には影響させない
        this.ipc.appSetting.notifyChanged(Object.keys(protectedValues));

        // ログレベルはこの (Service) プロセスにも即時反映する。
        // Operator / EPGUpdater 側は上の通知と各プロセスの起動時に反映される
        if (Object.keys(protectedValues).includes('logging') === true) {
            await this.logLevelApplier.apply().catch(() => {});
        }

        // config は「実際に config.yml と違う値になったキー」で再起動要否を判定する
        const changedConfigKeys =
            typeof value.config === 'undefined'
                ? []
                : diffConfigOverlayKeys(this.configuration.getFileConfig(), value.config);

        // 再起動が不要な項目はこのプロセスへ即時反映する
        // (Operator / EPGUpdater 側は notifyChanged を受けて各自で読み直す)
        if (typeof value.config !== 'undefined') {
            await this.configOverlayLoader.load().catch(() => {});
        }

        return this.buildUpdateResult(Object.keys(value), changedConfigKeys);
    }

    /**
     * 指定した key の変更履歴一覧 (新しい順、前の値そのものは含まない)
     */
    public async getHistory(key: string): Promise<AppSettingHistoryItem[]> {
        this.ensureEnabled();
        if (!APP_SETTING_ALLOWED_KEYS.has(key)) throw new Error(`UnknownAppSetting:${key}`);
        const rows = await this.history.list(key);
        return rows.map(r => ({ id: r.id, key: r.key, updatedAt: Number(r.updatedAt) }));
    }

    /**
     * 指定した key を直前の状態へロールバックする (1 回限りの undo)
     */
    public async rollback(key: string): Promise<AppSettingUpdateResult> {
        this.ensureEnabled();
        if (!APP_SETTING_ALLOWED_KEYS.has(key)) throw new Error(`UnknownAppSetting:${key}`);
        const last = await this.history.popLatest(key);
        if (last === null) throw new Error('AppSettingHistoryIsNotFound');
        let previousValue: unknown;
        try {
            previousValue = JSON.parse(last.previousValue);
        } catch {
            throw new Error('AppSettingHistoryIsInvalid');
        }
        await this.db.upsert({ [key]: previousValue });
        this.ipc.appSetting.notifyChanged([key]);
        return this.buildUpdateResult([key]);
    }

    private async buildUpdateResult(
        changedKeys: string[],
        changedConfigKeys: string[] = [],
    ): Promise<AppSettingUpdateResult> {
        const requiresRestartKeys = [
            ...changedKeys.filter(key => appSettingRequiresRestart(key)),
            // config は個々のキーごとに再起動要否が違う
            ...configOverlayRequiresRestart(changedConfigKeys).map(key => `config.${key}`),
        ];
        return {
            settings: this.transformSecrets(await this.db.getAll(), null, 'mask') as Record<string, unknown>,
            requiresRestart: requiresRestartKeys.length > 0,
            requiresRestartKeys,
        };
    }

    /**
     * value を current と突き合わせながらシークレットのマスク/暗号化を行う。
     * - オブジェクト配下は "parent.child" の path を積み上げながら再帰する
     * - 配列は各要素が一意な文字列 "name" を持つ場合、旧配列とは name で突き合わせる
     *   (name を持たない場合のみ従来通りインデックスで突き合わせる、§S5 の並べ替え・削除対応)
     * @param value: 変換対象
     * @param current: 対応する既存値 (突き合わせ用)
     * @param mode: 'encrypt' (PUT 時に平文を暗号化) | 'mask' (GET 応答用にマスクする)
     * @param path: 現在地点までのキーパス (ドット区切り、配列はスキップ)
     */
    private transformSecrets(value: unknown, current: unknown, mode: TransformMode, path = ''): unknown {
        if (Array.isArray(value)) {
            const currentArray = Array.isArray(current) ? current : [];
            const matchedCurrent = this.matchArrayItems(value, currentArray);
            return value.map((item, index) => this.transformSecrets(item, matchedCurrent[index], mode, path));
        }
        if (typeof value === 'object' && value !== null) {
            const source = value as Record<string, unknown>;
            const currentObject =
                typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};
            return Object.fromEntries(
                Object.entries(source).map(([childKey, child]) => [
                    childKey,
                    this.transformSecrets(
                        child,
                        currentObject[childKey],
                        mode,
                        path === '' ? childKey : `${path}.${childKey}`,
                    ),
                ]),
            );
        }
        if (typeof value !== 'string') return value;

        const lastDot = path.lastIndexOf('.');
        const key = lastDot === -1 ? path : path.slice(lastDot + 1);
        const parentPath = lastDot === -1 ? '' : path.slice(0, lastDot);
        const secretKeys =
            parentPath === 'notifications.targets'
                ? AppSettingApiModel.TARGET_SECRET_KEYS
                : AppSettingApiModel.SECRET_KEYS;
        if (!secretKeys.has(key)) return value;

        if (mode === 'mask') {
            if (value === '') return '';
            try {
                return this.crypto.isEncrypted(value) ? this.crypto.mask(value) : `********${value.slice(-4)}`;
            } catch {
                // secretKey 未設定・鍵ローテーション後で復号できない場合でも例外を投げず、
                // この項目だけを判別可能なプレースホルダに差し替えて画面を開けるようにする (§6.6)
                return AppSettingApiModel.UNDECRYPTABLE_PLACEHOLDER;
            }
        }

        // mode === 'encrypt'
        if (value === '') return '';
        if (value.startsWith('********')) {
            // マスク値がそのまま送り返されてきたケース。対応する既存の暗号文が無い場合、
            // マスク文字列自体を本物のシークレットとして保存してしまうバグを防ぐため、必ずエラーにする (§S5)
            if (typeof current !== 'string' || current.length === 0) {
                throw new Error(`AppSettingInvalid:${path}:masked value has no corresponding existing secret`);
            }
            // v1 形式で保存されている既存の暗号文は、次回の更新のタイミングで v2 へ移行する
            if (current.startsWith('enc:v1:')) {
                try {
                    return this.crypto.encrypt(this.crypto.decrypt(current));
                } catch {
                    return current;
                }
            }
            return current;
        }
        return this.crypto.encrypt(value);
    }

    /**
     * 新しい配列 (newItems) の各要素に対応する、旧配列 (currentItems) 側の要素を求める。
     * 両方の配列の要素が全て一意な文字列 "name" プロパティを持つオブジェクトであれば name で突き合わせ、
     * そうでなければ従来通りインデックスで対応させる (フォールバック)
     */
    private matchArrayItems(newItems: unknown[], currentItems: unknown[]): unknown[] {
        const isNamedObject = (x: unknown): x is Record<string, unknown> & { name: string } =>
            typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).name === 'string';

        if (newItems.every(isNamedObject) && currentItems.every(isNamedObject)) {
            const byName = new Map<string, unknown>();
            for (const c of currentItems) byName.set((c as { name: string }).name, c);
            return newItems.map(item => byName.get((item as { name: string }).name));
        }

        return newItems.map((_, index) => currentItems[index]);
    }

    private ensureEnabled(): void {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'systemSettings')) {
            throw new Error('SystemSettingsFeatureIsDisabled');
        }
    }

    /**
     * オーバーレイの中から、maskConfig() が返す伏せ字 (CONFIG_SECRET_PLACEHOLDER) のまま
     * 送り返されてきた leaf を再帰的に取り除く。画面を一度も編集していない秘密情報欄は
     * 伏せ字のまま提出されるため、それをそのまま保存すると本物のシークレットが伏せ字で
     * 上書きされてしまう事故を防ぐ (§指摘6)
     */
    private static stripMaskedPlaceholders(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(item => AppSettingApiModel.stripMaskedPlaceholders(item));
        }
        if (typeof value === 'object' && value !== null) {
            const result: Record<string, unknown> = {};
            for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
                if (child === AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER) continue;
                result[childKey] = AppSettingApiModel.stripMaskedPlaceholders(child);
            }
            return result;
        }
        return value;
    }

    /**
     * オーバーレイのうち、config.yml (既定値補完後) と厳密に同じ値になった leaf を取り除く。
     * 一度画面で変更してから元の値に手動で戻した項目が、差分として永久に残るのを防ぐ (§指摘7)。
     * オブジェクトは leaf 単位で比較して再帰的に絞り込むが、配列は mergeConfigOverlay 側が
     * 「丸ごと置き換え」の単位として扱っている (recorded / encode / stream 等) ため、
     * leaf には分解せず配列全体が一致する場合にのみ落とす
     */
    private static pruneLeavesEqualToFileConfig(
        overlay: Record<string, unknown>,
        fileConfig: Record<string, unknown>,
    ): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(overlay)) {
            const fileValue = fileConfig[key];
            if (Array.isArray(value)) {
                if (JSON.stringify(value) !== JSON.stringify(fileValue ?? undefined)) result[key] = value;
                continue;
            }
            if (typeof value === 'object' && value !== null) {
                const fileObject =
                    typeof fileValue === 'object' && fileValue !== null && !Array.isArray(fileValue)
                        ? (fileValue as Record<string, unknown>)
                        : {};
                const pruned = AppSettingApiModel.pruneLeavesEqualToFileConfig(
                    value as Record<string, unknown>,
                    fileObject,
                );
                if (Object.keys(pruned).length > 0) result[key] = pruned;
                continue;
            }
            if (JSON.stringify(value) !== JSON.stringify(fileValue ?? undefined)) result[key] = value;
        }
        return result;
    }
}
