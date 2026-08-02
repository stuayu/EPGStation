import { DataBroadcastingParam } from './IDataBroadcastingManageModel';

/**
 * データ放送 WebSocket の `?param=<JSON>` クエリを手動で検証してパラメータへ変換する。
 * 不正な形式はすべて null を返す (呼び出し側で 1008 で切断する)
 * @param urlStr: string | undefined リクエスト URL (クエリ含む)
 * @return DataBroadcastingParam | null
 */
export function parseDataBroadcastingParam(urlStr: string | undefined): DataBroadcastingParam | null {
    if (typeof urlStr === 'undefined') {
        return null;
    }

    let paramStr: string | null;
    try {
        paramStr = new URL(urlStr, 'http://localhost').searchParams.get('param');
    } catch (err) {
        return null;
    }
    if (paramStr === null) {
        return null;
    }

    let query: unknown;
    try {
        query = JSON.parse(paramStr);
    } catch (err) {
        return null;
    }
    if (typeof query !== 'object' || query === null) {
        return null;
    }

    const q = query as Record<string, unknown>;
    const demultiplexServiceId = typeof q.demultiplexServiceId === 'number' ? q.demultiplexServiceId : undefined;

    if (q.type === 'epgStationLive' && typeof q.channelId === 'number') {
        return {
            type: 'epgStationLive',
            channelId: q.channelId,
            demultiplexServiceId,
        };
    }

    if (q.type === 'epgStationRecorded' && typeof q.videoFileId === 'number') {
        const seek = typeof q.seek === 'number' ? q.seek : undefined;

        return {
            type: 'epgStationRecorded',
            videoFileId: q.videoFileId,
            seek,
            demultiplexServiceId,
        };
    }

    return null;
}
