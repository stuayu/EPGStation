/**
 * TS ファイルの PSI/SI から取り出した放送情報
 * 取得できなかった項目は null になる
 */
export interface TsInfo {
    // --- 放送・サービスの識別子 (SDT / PAT / NIT) ---
    networkId: number | null; // original_network_id
    transportStreamId: number | null;
    serviceId: number | null;
    serviceType: number | null;
    serviceName: string | null; // 放送局名 (service_descriptor)
    serviceProviderName: string | null;
    networkName: string | null; // ネットワーク名 (network_name_descriptor)

    // --- EIT[p/f] present の番組情報 ---
    eventId: number | null;
    eventName: string | null;
    eventDescription: string | null; // short_event_descriptor の text
    eventExtended: string | null; // extended_event_descriptor を連結したもの
    eventStartAt: number | null; // UNIX 時刻 (ミリ秒)
    eventDuration: number | null; // 秒
    genres: TsGenre[];

    // --- PMT のストリーム構成 ---
    videoStreamType: number | null;
    videoPid: number | null;
    audioStreamType: number | null;
    audioPid: number | null;

    // --- TDT ---
    // ファイル先頭付近で最初に現れた放送時刻 (UNIX 時刻・ミリ秒)
    // 録画開始時刻に相当するため、ファイルの更新時刻からの推定より正確
    firstTdtAt: number | null;
}

/**
 * content_descriptor 由来のジャンル (EPGStation の genre1 / subGenre1 と同じ形式)
 */
export interface TsGenre {
    lv1: number;
    lv2: number;
}

export interface TsInfoAnalyzeOption {
    // 解析のために読み込む最大バイト数
    maxReadBytes?: number;
    // 解析の打ち切り時間 (ミリ秒)
    timeoutMs?: number;
}

export default interface ITsInfoAnalyzer {
    analyze(filePath: string, option?: TsInfoAnalyzeOption): Promise<TsInfo>;
}
