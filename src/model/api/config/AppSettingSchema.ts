/**
 * システム設定 (app_setting) の JSON Schema 定義 (§6.3)。
 * トップレベルキーごとに構造・型・サイズ上限を定義する単一ソース。
 * AppSettingApiModel はこれを使って値の検証を行い、また各項目の requiresRestart 宣言を
 * 変更内容から restartRequired の算出に用いる。
 *
 * 依存ライブラリ (ajv 等) を追加せずに済む範囲の軽量な独自実装。
 * サポートする機能: type / properties / required / additionalProperties / enum /
 * minimum / maximum / maxLength / items / const な同等の範囲のみ
 */
import { LOG_LEVELS } from '../../log/LogLevel';

export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean';

export interface JsonSchema {
    type: SchemaType;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    enum?: Array<string | number>;
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    items?: JsonSchema;
    // true の場合、この項目の変更は Operator プロセスの再初期化 (再起動相当) を要する (§6.3)
    requiresRestart?: boolean;
}

const notificationTargetSchema: JsonSchema = {
    type: 'object',
    required: ['name', 'type', 'url'],
    additionalProperties: true,
    properties: {
        name: { type: 'string', maxLength: 100 },
        type: { type: 'string', enum: ['webhook', 'discord'] },
        url: { type: 'string', maxLength: 2000 },
        secret: { type: 'string', maxLength: 500 },
        events: { type: 'array', items: { type: 'string', maxLength: 50 } },
    },
};

// しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 1 エントリ分 (§5.3・§6.2)
const syobocalChannelMapEntrySchema: JsonSchema = {
    type: 'object',
    required: ['chId', 'networkId', 'serviceId'],
    additionalProperties: false,
    properties: {
        chId: { type: 'number', minimum: 0, maximum: 1000000 },
        networkId: { type: 'number', minimum: 0, maximum: 1000000 },
        serviceId: { type: 'number', minimum: 0, maximum: 1000000 },
        // 未登録局フラグ (false の場合、しょぼいカレンダーへの問い合わせ自体をスキップする)
        syobocal: { type: 'boolean' },
    },
};

export const APP_SETTING_SCHEMA: Record<string, JsonSchema> = {
    metadata: {
        type: 'object',
        additionalProperties: true,
        properties: {
            cacheTtlMs: { type: 'number', minimum: 0, maximum: 30 * 24 * 60 * 60 * 1000 },
            annict: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    enabled: { type: 'boolean' },
                    token: { type: 'string', maxLength: 500 },
                    // 視聴記録の自動同期 (opt-in, §5.5)。featureFlags.annictSync (config.yml) が
                    // OFF の場合はこの値に関わらず同期は動作しない (二重ゲート)
                    syncEnabled: { type: 'boolean' },
                    // 作品辞書の自動同期間隔 (ms)。0 で自動同期を停止する
                    workSyncIntervalMs: { type: 'number', minimum: 0, maximum: 90 * 24 * 60 * 60 * 1000 },
                },
            },
            syobocal: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    enabled: { type: 'boolean' },
                    // アニメ作品タイトル辞書の自動同期間隔 (ms)。0 で自動同期を停止する
                    titleSyncIntervalMs: { type: 'number', minimum: 0, maximum: 30 * 24 * 60 * 60 * 1000 },
                },
            },
            // 外部サービスのエンドポイント URL (Cloudflare 等のキャッシュを経由させる場合に差し替える)。
            // 空文字は「未設定」として扱い、config.yml → 同梱既定値へフォールバックする
            endpoints: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    syobocal: { type: 'string', maxLength: 2000 },
                    annict: { type: 'string', maxLength: 2000 },
                    fxtwitter: { type: 'string', maxLength: 2000 },
                    sharedData: { type: 'string', maxLength: 2000 },
                },
            },
            // 共有静的データ (チャンネルマッピング表・エイリアス辞書, §5.1・§5.8) の自動更新設定
            sharedData: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    autoUpdate: { type: 'boolean' },
                },
            },
        },
    },
    // しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 (§5.3・§6.2)。
    // 解決順は「同梱データ → 共有静的データ → ローカルファイル (metadataChannelMappingPath) →
    // この DB 設定」の順で後勝ち (SyobocalChannelMap.load() 参照)
    syobocalChannelMap: {
        type: 'array',
        items: syobocalChannelMapEntrySchema,
    },
    notifications: {
        type: 'object',
        additionalProperties: true,
        // 通知先 URL への配送先を変えるだけなので Operator の再起動は不要
        requiresRestart: false,
        properties: {
            enabled: { type: 'boolean' },
            maxAttempts: { type: 'number', minimum: 1, maximum: 20 },
            baseDelayMs: { type: 'number', minimum: 0, maximum: 60 * 60 * 1000 },
            timeoutMs: { type: 'number', minimum: 100, maximum: 5 * 60 * 1000 },
            allowPrivateNetworkTargets: { type: 'boolean' },
            targets: { type: 'array', items: notificationTargetSchema },
        },
    },
    series: {
        type: 'object',
        additionalProperties: true,
        properties: {
            matchThreshold: { type: 'number', minimum: 0, maximum: 1 },
        },
    },
    dashboard: {
        type: 'object',
        additionalProperties: true,
        properties: {},
    },
    // config.yml への重ね書き (GUI から編集した設定)。
    // 構造は config.yml と同じで、編集を許可するトップレベルキーは
    // CONFIG_OVERLAY_FIELDS (src/model/config/ConfigOverlay.ts) が持つ。
    // 個々の値の検証は ConfigOverlay 側で行うためここでは型だけを見る
    config: {
        type: 'object',
        additionalProperties: true,
        // 再起動要否はキーごとに変わるため、ここでは false 固定にして
        // AppSettingApiModel が configOverlayRequiresRestart() で判定する
        requiresRestart: false,
        properties: {},
    },
    // ログレベル (config/*LogConfig.yml がベースで、ここで指定したカテゴリだけを上書きする)。
    // log4js のロガーへ即時反映できるため再起動は不要
    logging: {
        type: 'object',
        additionalProperties: false,
        requiresRestart: false,
        properties: {
            levels: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    system: { type: 'string', enum: [...LOG_LEVELS] },
                    access: { type: 'string', enum: [...LOG_LEVELS] },
                    stream: { type: 'string', enum: [...LOG_LEVELS] },
                    encode: { type: 'string', enum: [...LOG_LEVELS] },
                },
            },
        },
    },
};

export const APP_SETTING_ALLOWED_KEYS = new Set(Object.keys(APP_SETTING_SCHEMA));

// 最大シリアライズサイズ (バイト)。巨大 JSON が丸ごと DB に入るのを防ぐ (§S5-11)
const MAX_VALUE_BYTES = 256 * 1024;

function typeOf(value: unknown): SchemaType | 'null' | 'undefined' {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as SchemaType;
}

function validateAgainst(schema: JsonSchema, value: unknown, path: string): void {
    if (typeof value === 'undefined') return; // 省略は許可 (部分更新のため)
    const actual = typeOf(value);
    if (schema.type === 'number' && actual === 'number') {
        if (!Number.isFinite(value)) throw new Error(`AppSettingInvalid:${path}:must be finite number`);
        if (typeof schema.minimum === 'number' && (value as number) < schema.minimum) {
            throw new Error(`AppSettingInvalid:${path}:must be >= ${schema.minimum}`);
        }
        if (typeof schema.maximum === 'number' && (value as number) > schema.maximum) {
            throw new Error(`AppSettingInvalid:${path}:must be <= ${schema.maximum}`);
        }
        return;
    }
    if (schema.type !== actual) {
        throw new Error(`AppSettingInvalid:${path}:expected ${schema.type} but got ${actual}`);
    }
    if (schema.type === 'string') {
        if (typeof schema.maxLength === 'number' && (value as string).length > schema.maxLength) {
            throw new Error(`AppSettingInvalid:${path}:string too long (max ${schema.maxLength})`);
        }
        if (schema.enum && !schema.enum.includes(value as string)) {
            throw new Error(`AppSettingInvalid:${path}:must be one of ${schema.enum.join(',')}`);
        }
        return;
    }
    if (schema.type === 'array') {
        const arr = value as unknown[];
        if (schema.items) {
            arr.forEach((item, i) => validateAgainst(schema.items as JsonSchema, item, `${path}[${i}]`));
        }
        return;
    }
    if (schema.type === 'object') {
        const obj = value as Record<string, unknown>;
        for (const key of schema.required ?? []) {
            if (typeof obj[key] === 'undefined') throw new Error(`AppSettingInvalid:${path}.${key}:required`);
        }
        for (const [key, child] of Object.entries(obj)) {
            const childSchema = schema.properties?.[key];
            if (childSchema) {
                validateAgainst(childSchema, child, `${path}.${key}`);
            } else if (schema.additionalProperties === false) {
                throw new Error(`AppSettingInvalid:${path}.${key}:unknown property`);
            }
        }
    }
}

/**
 * トップレベルキーごとの値を JSON Schema に照らして検証する。
 * 不正な型・範囲外の値・許可されていないキー・巨大すぎる値を弾く
 * @param key: トップレベルキー (metadata / notifications / series / dashboard)
 * @param value: 検証対象の値
 */
export function validateAppSettingValue(key: string, value: unknown): void {
    const schema = APP_SETTING_SCHEMA[key];
    if (!schema) throw new Error(`UnknownAppSetting:${key}`);
    const size = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (size > MAX_VALUE_BYTES)
        throw new Error(`AppSettingInvalid:${key}:value too large (max ${MAX_VALUE_BYTES} bytes)`);
    validateAgainst(schema, value, key);
}

/**
 * 指定したトップレベルキーの変更が Operator プロセスの再初期化を要するか
 * @param key: トップレベルキー
 * @return boolean (既定は false = 再起動不要)
 */
export function appSettingRequiresRestart(key: string): boolean {
    return APP_SETTING_SCHEMA[key]?.requiresRestart === true;
}
