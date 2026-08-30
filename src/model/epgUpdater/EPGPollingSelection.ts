export interface PollingChannelCandidate {
    channelId: number;
    activeStream?: boolean;
    recording?: boolean;
    upcomingRecording?: boolean;
}

/** 優先順位を保った polling 対象チャンネル選択。重複は除去する。 */
export const selectEPGPollingChannels = (candidates: PollingChannelCandidate[], limit: number): number[] => {
    const result: number[] = [];
    const seen = new Set<number>();
    const add = (predicate: (candidate: PollingChannelCandidate) => boolean): void => {
        for (const candidate of candidates) {
            if (result.length >= Math.max(0, limit) || seen.has(candidate.channelId) || predicate(candidate) === false)
                continue;
            seen.add(candidate.channelId);
            result.push(candidate.channelId);
        }
    };
    add(c => c.activeStream === true);
    add(c => c.recording === true);
    add(c => c.upcomingRecording === true);
    return result;
};
