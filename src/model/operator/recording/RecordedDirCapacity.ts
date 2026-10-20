/**
 * 録画先の空き容量判定。
 *
 * 録画を始めてから ENOSPC で失敗すると、0 バイトのファイルと失敗した録画情報だけが残り、
 * リトライしても同じディレクトリへ書きに行くため復旧しない。
 * 開始前に「その番組がどれくらいの大きさになるか」を見積もり、足りなければ
 * `config.recorded` の次の候補へ振り替える。
 *
 * ここは I/O を持たない純粋な判定だけを置く (空き容量の取得は呼び出し側)。
 */
import { RecordedDirInfo } from '../../IConfigFile';

/** channelType ごとの想定ビットレート (bps) */
export interface RecordingBitrateTable {
    [channelType: string]: number;
}

export interface StorageFallbackConfig {
    // 空き容量不足時に次の録画先へ振り替えるか
    enabled: boolean;
    // 見積もりに上乗せする余裕 (byte)
    marginBytes: number;
    // channelType ごとの想定ビットレート (bps)
    bitrate: RecordingBitrateTable;
    // 表に無い channelType へ使うビットレート (bps)
    defaultBitrate: number;
    // 設定で channelType によらず上書きするビットレート (bps)。未指定は null
    overrideBitrate: number | null;
}

/**
 * 既定の想定ビットレート。
 * 地上波は 16〜17Mbps、BS は 24Mbps 前後で送出されるため、多めの側へ寄せてある。
 * 県外地上波 (NW1〜NW40) は地上波と同じ。
 */
export const DEFAULT_RECORDING_BITRATE: Readonly<RecordingBitrateTable> = Object.freeze({
    GR: 19_000_000,
    BS: 26_000_000,
    CS: 20_000_000,
    SKY: 20_000_000,
    BS4K: 40_000_000,
    CS4K: 40_000_000,
});

export const DEFAULT_STORAGE_FALLBACK_CONFIG: Readonly<StorageFallbackConfig> = Object.freeze({
    enabled: true,
    // 録画中に他の録画・エンコードも書き込むため、番組 1 本分とは別に余裕を持たせる
    marginBytes: 3 * 1024 * 1024 * 1024,
    bitrate: DEFAULT_RECORDING_BITRATE,
    defaultBitrate: 19_000_000,
    overrideBitrate: null,
});

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
};

/**
 * config の値から空き容量振り替え設定を組み立てる。範囲外・不正値は既定へ丸める
 * @param value: unknown config.recording 相当のオブジェクト
 * @return StorageFallbackConfig
 */
export const resolveStorageFallbackConfig = (value: unknown): StorageFallbackConfig => {
    const d = DEFAULT_STORAGE_FALLBACK_CONFIG;
    if (value === null || typeof value !== 'object') {
        return { ...d, bitrate: { ...d.bitrate } };
    }

    const source = value as { [key: string]: unknown };
    // Mbps で受けて bps へ直す。未指定・0 以下・異常値は channelType ごとの既定表を使う
    const mbps = source.storageFallbackBitrateMbps;
    const overrideBitrate =
        typeof mbps === 'number' && Number.isFinite(mbps) === true && mbps > 0
            ? Math.round(clampNumber(mbps, 0, 0.1, 500) * 1_000_000)
            : null;

    return {
        enabled: source.storageFallbackEnabled !== false,
        marginBytes: Math.round(
            clampNumber(source.storageFallbackMarginMB, d.marginBytes / 1024 / 1024, 0, 1024 * 1024) * 1024 * 1024,
        ),
        bitrate: { ...d.bitrate },
        defaultBitrate: d.defaultBitrate,
        overrideBitrate: overrideBitrate,
    };
};

/**
 * 予約の録画サイズを見積もる
 * @param durationMs: number 番組長 (ms)
 * @param channelType: string
 * @param config: StorageFallbackConfig
 * @return number 予想バイト数 (余裕込み)
 */
export const estimateRecordingBytes = (
    durationMs: number,
    channelType: string,
    config: StorageFallbackConfig,
): number => {
    const bitrate = config.overrideBitrate ?? config.bitrate[channelType] ?? config.defaultBitrate;
    // 放送時間未定 (ProgramDuration が暫定値を入れる) や異常値でも負にはしない
    const durationSec = Math.max(0, durationMs) / 1000;

    return Math.round((durationSec * bitrate) / 8) + config.marginBytes;
};

export interface DirCandidate {
    dir: RecordedDirInfo;
    // 空き容量 (byte)。取得できなかった場合は null
    freeBytes: number | null;
}

export type DirSelectionReason =
    // 最初の候補で足りた (振り替えなし)
    | 'primary'
    // 空き不足で次の候補へ振り替えた
    | 'fallback'
    // どこも足りないので最も空きが大きい候補を使う
    | 'insufficient'
    // 空き容量を 1 つも取得できなかったので最初の候補のまま
    | 'unknown';

export interface DirSelection {
    dir: RecordedDirInfo;
    reason: DirSelectionReason;
    freeBytes: number | null;
}

/**
 * 予想サイズを満たす録画先を優先順に選ぶ。
 *
 * `candidates` は優先順 (先頭が第一候補) で渡す。先頭から順に空きを見て、
 * 予想サイズを満たす最初の候補を返す。どこも満たさない場合は録画が全損しないよう
 * 最も空きが大きい候補を返す。
 *
 * @param candidates: DirCandidate[] 優先順の候補
 * @param requiredBytes: number 必要バイト数
 * @return DirSelection | null 候補が空の場合は null
 */
export const selectRecordedDir = (candidates: DirCandidate[], requiredBytes: number): DirSelection | null => {
    if (candidates.length === 0) {
        return null;
    }

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.freeBytes !== null && c.freeBytes >= requiredBytes) {
            return {
                dir: c.dir,
                reason: i === 0 ? 'primary' : 'fallback',
                freeBytes: c.freeBytes,
            };
        }
    }

    // 空き容量を 1 つも取得できなかった場合は判断材料が無いので第一候補のまま進める
    const measured = candidates.filter(c => c.freeBytes !== null);
    if (measured.length === 0) {
        return { dir: candidates[0].dir, reason: 'unknown', freeBytes: null };
    }

    // どこも足りない。少しでも長く録るため最も空きが大きい候補を使う
    const best = measured.reduce((a, b) => ((b.freeBytes as number) > (a.freeBytes as number) ? b : a));

    return { dir: best.dir, reason: 'insufficient', freeBytes: best.freeBytes };
};

export interface CapacitySimulationReserve {
    id: number;
    name?: string;
    startAt: number;
    endAt: number;
    channelType: string;
    isSkip?: boolean;
    isConflict?: boolean;
    plannedTunerIndex?: number | null;
    startMarginMs?: number;
    endMarginMs?: number;
    parentDirectoryName?: string | null;
}

export interface CapacitySimulationResult {
    reservedEstimatedSize: Record<string, number>;
    firstInsufficientReserve: { id: number; startAt: number; dirName: string } | null;
    firstInsufficientReserveByDir: Record<string, { id: number; startAt: number; name: string }>;
}

/**
 * 予約順に保存先を割り当て、空き容量を消費する純粋シミュレーション。
 * 録画開始時と同じ selectRecordedDir を使う。
 * @param reserves: CapacitySimulationReserve[] 開始時刻順
 * @param dirs: DirCandidate[] 優先順の保存先
 * @param config: StorageFallbackConfig 見積もり設定
 * @return CapacitySimulationResult
 */
export const simulateRecordedDirCapacity = (
    reserves: CapacitySimulationReserve[],
    dirs: DirCandidate[],
    config: StorageFallbackConfig,
): CapacitySimulationResult => {
    const remaining = dirs.map(candidate => ({ ...candidate }));
    const reservedEstimatedSize: Record<string, number> = Object.fromEntries(dirs.map(c => [c.dir.name, 0]));
    let firstInsufficientReserve: CapacitySimulationResult['firstInsufficientReserve'] = null;
    const firstInsufficientReserveByDir: CapacitySimulationResult['firstInsufficientReserveByDir'] = {};

    for (const reserve of [...reserves].sort((a, b) => a.startAt - b.startAt)) {
        if (reserve.isSkip === true || reserve.isConflict === true) continue;
        const durationMs = Math.max(
            0,
            reserve.endAt - reserve.startAt + Math.max(0, reserve.startMarginMs ?? 0) + Math.max(0, reserve.endMarginMs ?? 0),
        );
        const size = estimateRecordingBytes(durationMs, reserve.channelType, config);
        const preferredIndex = reserve.parentDirectoryName
            ? remaining.findIndex(candidate => candidate.dir.name === reserve.parentDirectoryName)
            : -1;
        const candidates =
            preferredIndex > 0
                ? [remaining[preferredIndex], ...remaining.filter((_, index) => index !== preferredIndex)]
                : remaining;
        const selection = selectRecordedDir(config.enabled === false ? candidates.slice(0, 1) : candidates, size);
        if (selection === null) continue;
        const name = selection.dir.name;
        reservedEstimatedSize[name] = (reservedEstimatedSize[name] ?? 0) + size;
        if (selection.reason === 'insufficient' && firstInsufficientReserve === null) {
            firstInsufficientReserve = { id: reserve.id, startAt: reserve.startAt, dirName: name };
        }
        if (selection.reason === 'insufficient' && typeof firstInsufficientReserveByDir[name] === 'undefined') {
            firstInsufficientReserveByDir[name] = { id: reserve.id, startAt: reserve.startAt, name: reserve.name ?? '' };
        }
        const target = remaining.find(candidate => candidate.dir.path === selection.dir.path);
        if (target?.freeBytes !== null && typeof target?.freeBytes === 'number') target.freeBytes = Math.max(0, target.freeBytes - size);
    }

    return { reservedEstimatedSize, firstInsufficientReserve, firstInsufficientReserveByDir };
};
