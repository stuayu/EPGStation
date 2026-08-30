import Program from '../../../db/entities/Program';

export interface EitOnAirRecord {
    eventId: number;
    startAt: number | null;
    durationSec: number | null;
    receivedAt: number;
    isFollowing: boolean;
}

export const EIT_FRESHNESS_MS = 2 * 60 * 1000;

export const getMirakurunProgramId = (networkId: number, serviceId: number, eventId: number): number =>
    (networkId * 100000 + serviceId) * 100000 + eventId;

/** 新しい EIT present が DB の現在番組候補を上書きするか判定する。 */
export const resolveEitOnAirProgram = (
    programs: Program[],
    channel: { networkId: number; serviceId: number },
    eit: EitOnAirRecord | null,
    now: number,
    freshnessMs: number = EIT_FRESHNESS_MS,
): Program | null => {
    if (eit === null || eit.isFollowing === true || now - eit.receivedAt > freshnessMs) return null;
    const id = getMirakurunProgramId(channel.networkId, channel.serviceId, eit.eventId);
    return programs.find(program => program.id === id) ?? null;
};
