import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import IAppSettingHistoryDB from '../../db/IAppSettingHistoryDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IConfigOverlayLoader from '../../config/IConfigOverlayLoader';
import {
    CONFIG_OVERLAY_FIELDS,
    configOverlayRequiresRestart,
    diffConfigOverlayKeys,
    sanitizeConfigOverlay,
} from '../../config/ConfigOverlay';
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

@injectable()
export default class AppSettingApiModel implements IAppSettingApiModel {
    // トップレベル・ネスト問わずどこにあっても秘密情報として扱うキー
    private static readonly SECRET_KEYS = new Set(['token', 'apiKey', 'secret', 'password']);
    // notifications.targets 配下でのみ url も秘密情報として扱う (Discord Webhook URL 等、§7.3)
    private static readonly TARGET_SECRET_KEYS = new Set(['token', 'apiKey', 'secret', 'password', 'url']);
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
        return {
            effective: this.maskConfig(this.configuration.getConfig() as unknown as Record<string, unknown>),
            file: this.maskConfig(this.configuration.getFileConfig() as unknown as Record<string, unknown>),
            overlay: this.maskConfig(this.configuration.getOverlay()),
            fields: CONFIG_OVERLAY_FIELDS.map(x => ({ key: x.key as string, requiresRestart: x.requiresRestart })),
        };
    }

    /**
     * config の中の秘密情報を伏せる。
     * config.yml は管理者が直接読めるファイルだが、画面へ出す以上は不要な露出を避ける
     */
    private maskConfig(value: Record<string, unknown>): Record<string, unknown> {
        const cloned = JSON.parse(JSON.stringify(value ?? {}));
        // LLM の API キーなど、config.yml 側に書かれる秘密情報
        if (typeof cloned?.seriesLlm?.apiKey === 'string' && cloned.seriesLlm.apiKey !== '') {
            cloned.seriesLlm.apiKey = AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER;
        }
        return cloned;
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
            // 伏せ字のまま送り返されたら「変更なし」とみなして既存値を消さない
            const llm = overlay.seriesLlm as { apiKey?: string } | undefined;
            if (llm?.apiKey === AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER) {
                delete llm.apiKey;
            }
            value.config = overlay;
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
}
