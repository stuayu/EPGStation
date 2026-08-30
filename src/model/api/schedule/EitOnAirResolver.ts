import Program from '../../../db/entities/Program';

export interface EitOnAirRecord {
    eventId: number;
    startAt: number | null;
    durationSec: number | null;
    /** ARIB running_status。未指定の既存 IPC 値は従来互換で受け入れる。 */
    runningStatus?: number;
    receivedAt: number;
    isFollowing: boolean;
}

export const EIT_FRESHNESS_MS = 2 * 60 * 1000;

export const getMirakurunProgramId = (networkId: number, serviceId: number, eventId: number): number =>
    (networkId * 100000 + serviceId) * 100000 + eventId;

/**
 * EIT[p/f] の present から、放送波を正とした放送時刻を求める
 * @param eit: EitOnAirRecord
 * @param fallbackStartAt: number EIT が開始時刻を持たない場合に使う値 (DB の値)
 * @param fallbackEndAt: number 放送時間未定の場合に使う暫定終了時刻 (DB の値)
 * @return { startAt, endAt, isDurationUndefined }
 */
export const resolveEitBroadcastTime = (
    eit: EitOnAirRecord,
    fallbackStartAt: number,
    fallbackEndAt: number,
): { startAt: number; endAt: number; isDurationUndefined: boolean } => {
    const startAt = eit.startAt ?? fallbackStartAt;
    // durationSec が null = ARIB の放送時間未定。終了時刻を確定値として出さない
    if (eit.durationSec === null) {
        return { startAt: startAt, endAt: Math.max(fallbackEndAt, startAt), isDurationUndefined: true };
    }

    return { startAt: startAt, endAt: startAt + eit.durationSec * 1000, isDurationUndefined: false };
};

/** 新しい EIT present が DB の現在番組候補を上書きするか判定する。 */
export const resolveEitOnAirProgram = (
    programs: Program[],
    channel: { networkId: number; serviceId: number },
    eit: EitOnAirRecord | null,
    now: number,
    freshnessMs: number = EIT_FRESHNESS_MS,
): Program | null => {
    // 1=not running / 2=starts in a few seconds は present として採用しない。
    // 0=undefined と 3=pausing は放送局が送る現在 event の情報を失わないため受け入れる。
    if (
        eit === null ||
        eit.isFollowing === true ||
        eit.runningStatus === 1 ||
        eit.runningStatus === 2 ||
        now - eit.receivedAt > freshnessMs
    )
        return null;
    const id = getMirakurunProgramId(channel.networkId, channel.serviceId, eit.eventId);
    return programs.find(program => program.id === id) ?? null;
};

/** 鮮度内の EIT[p/f] に対応する番組を返す (present/following 共通) */
export const resolveFreshEitProgram = (
    programs: Program[],
    channel: { networkId: number; serviceId: number },
    eit: EitOnAirRecord | null,
    now: number,
    freshnessMs: number = EIT_FRESHNESS_MS,
): Program | null => {
    if (eit === null || now - eit.receivedAt > freshnessMs) return null;
    const id = getMirakurunProgramId(channel.networkId, channel.serviceId, eit.eventId);
    return programs.find(program => program.id === id) ?? null;
};
