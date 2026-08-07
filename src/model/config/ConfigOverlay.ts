import IConfigFile from '../IConfigFile';
import { CONFIG_SCHEMA } from './ConfigSchema';

/**
 * config.yml を GUI から編集するための「重ね書き (オーバーレイ)」の定義。
 *
 * config.yml へは書き戻さない。書き戻すとコメントや書式が失われるうえ、
 * Configuration が fs.watchFile で監視しているため書き込みがリロードを誘発する。
 * 代わりに GUI で変更した値だけを DB (app_setting の config キー) に持ち、
 * 読み込み時に「config.yml → DB の値」の順で重ねて実効値を作る。
 *
 * これにより手編集派の config.yml はそのまま残り、GUI 派は画面だけで完結できる。
 *
 * GUI から編集できるキー・再起動要否は、以前はこのファイルの手書き配列
 * (`CONFIG_OVERLAY_FIELDS`) が定義元だったが、`ConfigSchema.ts` の
 * `CONFIG_SCHEMA` と定義が二重管理になり食い違いの温床になっていたため、
 * 現在は `CONFIG_SCHEMA` を唯一の定義元とし、ここではそこから導出するだけにする
 * (`editable === 'gui'` のエントリがオーバーレイ対象、`requiresRestart` もそのまま使う)。
 *
 * **DB 接続設定 (dbtype / mysql / sqlite / postgres) が対象に含まれないのも
 * ConfigSchema 側の判断**: オーバーレイ自体を DB から読むため、誤った接続設定を
 * 保存すると次回起動時に値を読み出せず復旧できなくなる (自己参照の詰み、
 * `reason: 'selfReference'`)。認証設定 (auth) も画面へ入る手段そのものなので
 * 同様に config.yml 専用にしている (`reason: 'authLockout'`)。理由の詳細は
 * `ConfigSchema.ts` の `YML_ONLY_REASONS` を参照
 */

export interface ConfigFieldDefinition {
    // config.yml のトップレベルキー
    key: keyof IConfigFile;
    // 変更に EPGStation の再起動が必要か (起動時にしか読まれない項目)
    requiresRestart: boolean;
}

/**
 * GUI から編集できるトップレベルキー一覧 (`ConfigSchema` の `editable === 'gui'` から導出)。
 *
 * 各キーの `requiresRestart` の根拠 (再起動不要と判断した理由) は
 * 元は本ファイルにコメントとして書かれていたが、定義元を ConfigSchema に一本化したため
 * 各エントリの JSDoc コメントとして `ConfigSchema.ts` 側へ移植した。参考までに転記:
 * - `recording`: RecorderModel は予約ごとに生成され、そのたびに config を読むため再起動不要
 * - `encodePresets`: EncodePresets.applyToConfig が formatConfig の都度 encode/stream.profiles を
 *   組み立て直すため再起動不要
 * - `stream`: StreamProfileManageModel は呼び出しのたびに config を読むため再起動不要
 * - `reserveNewAddtionCommand` 等の外部コマンド系: ExternalCommandManageModel がコンストラクタで
 *   config を読むため再起動が必要
 */
export const CONFIG_OVERLAY_FIELDS: readonly ConfigFieldDefinition[] = CONFIG_SCHEMA.filter(
    entry => entry.editable === 'gui',
).map(entry => ({ key: entry.key, requiresRestart: entry.requiresRestart }));

export const CONFIG_OVERLAY_KEYS: ReadonlySet<string> = new Set(CONFIG_OVERLAY_FIELDS.map(x => x.key as string));

const RESTART_REQUIRED_KEYS: ReadonlySet<string> = new Set(
    CONFIG_OVERLAY_FIELDS.filter(x => x.requiresRestart === true).map(x => x.key as string),
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false;

/**
 * オーバーレイから編集を許可していないキーを取り除く。
 * 画面や API から知らないキーが紛れ込んでも config へ混ぜない
 * @param overlay: unknown
 * @return Record<string, unknown>
 */
export const sanitizeConfigOverlay = (overlay: unknown): Record<string, unknown> => {
    if (isPlainObject(overlay) === false) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overlay)) {
        if (CONFIG_OVERLAY_KEYS.has(key) === false) continue;
        // undefined / null は「未設定に戻す」の意味なので落とし、config.yml の値を使わせる
        if (typeof value === 'undefined' || value === null) continue;
        result[key] = value;
    }
    return result;
};

/**
 * config.yml の値にオーバーレイを重ねる。
 * オブジェクトは再帰的にマージし、配列は丸ごと置き換える
 * (録画ディレクトリやエンコード設定は「一覧そのもの」を編集するため)
 * @param base: IConfigFile config.yml から読んだ値
 * @param overlay: unknown DB に保存された差分
 * @return IConfigFile 実効値
 */
export const mergeConfigOverlay = (base: IConfigFile, overlay: unknown): IConfigFile => {
    const sanitized = sanitizeConfigOverlay(overlay);
    if (Object.keys(sanitized).length === 0) return base;

    const result: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
    for (const [key, value] of Object.entries(sanitized)) {
        result[key] = isPlainObject(value) === true ? deepMerge(result[key], value) : value;
    }
    return result as unknown as IConfigFile;
};

const deepMerge = (base: unknown, overlay: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = isPlainObject(base) === true ? { ...base } : {};
    for (const [key, value] of Object.entries(overlay)) {
        if (typeof value === 'undefined' || value === null) {
            delete result[key];
            continue;
        }
        result[key] = isPlainObject(value) === true ? deepMerge(result[key], value) : value;
    }
    return result;
};

/**
 * 変更されたキーのうち、反映に再起動が必要なものを返す
 * @param keys: string[]
 * @return string[]
 */
export const configOverlayRequiresRestart = (keys: string[]): string[] => {
    if (Array.isArray(keys) === false) return [];
    return keys.filter(key => RESTART_REQUIRED_KEYS.has(key));
};

/**
 * config.yml とオーバーレイを比べ、実際に値が変わっているキーを返す
 * (再起動が必要かの判定を「送られてきたキー」ではなく「変わったキー」で行うため)
 * @param base: IConfigFile
 * @param overlay: unknown
 * @return string[]
 */
export const diffConfigOverlayKeys = (base: IConfigFile, overlay: unknown): string[] => {
    const sanitized = sanitizeConfigOverlay(overlay);
    const source = base as unknown as Record<string, unknown>;
    return Object.keys(sanitized).filter(key => JSON.stringify(source[key]) !== JSON.stringify(sanitized[key]));
};
