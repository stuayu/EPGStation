/** オフライン保存動画へ記録するニコニコ実況過去ログの取得範囲。 */
export interface OfflineJikkyoParam {
    jikkyoChannelId: string;
    jikkyoStartAt: number;
    jikkyoEndAt: number;
}

export interface OfflineJikkyoRecordLike {
    jikkyoChannelId?: unknown;
    jikkyoStartAt?: unknown;
    jikkyoEndAt?: unknown;
}

export type OfflineJikkyoResolution =
    { source: 'stored' | 'server'; param: OfflineJikkyoParam } | { source: 'none'; param: null };

const readParam = (record: OfflineJikkyoRecordLike | null | undefined): OfflineJikkyoParam | null => {
    if (
        record === null ||
        record === undefined ||
        typeof record.jikkyoChannelId !== 'string' ||
        record.jikkyoChannelId.length === 0 ||
        typeof record.jikkyoStartAt !== 'number' ||
        Number.isFinite(record.jikkyoStartAt) === false ||
        typeof record.jikkyoEndAt !== 'number' ||
        Number.isFinite(record.jikkyoEndAt) === false ||
        record.jikkyoStartAt >= record.jikkyoEndAt
    ) {
        return null;
    }

    return {
        jikkyoChannelId: record.jikkyoChannelId,
        jikkyoStartAt: record.jikkyoStartAt,
        jikkyoEndAt: record.jikkyoEndAt,
    };
};

/** 保存済み値・オンライン状態・サーバー解決値から実況パラメータを決める。 */
export const resolveOfflineJikkyoParam = (
    record: OfflineJikkyoRecordLike | null | undefined,
    isOnline: boolean,
    serverParam: OfflineJikkyoParam | null = null,
): OfflineJikkyoResolution => {
    if (isOnline === false) return { source: 'none', param: null };

    const stored = readParam(record);
    if (stored !== null) return { source: 'stored', param: stored };

    const resolved = readParam(serverParam);
    return resolved === null ? { source: 'none', param: null } : { source: 'server', param: resolved };
};
