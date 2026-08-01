import { BitSectionInfo } from '../../channel/BitParser';

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

    // --- EIT[p/f] の component_descriptor / audio_component_descriptor ---
    // Mirakurun の program.video / program.audio と同じ形式に変換した値。
    // EPGStation で録画した番組と同じ項目を、取り込み・アップロードした TS からも埋められるようにする
    videoType: string | null; // 'mpeg2' / 'h.264' / 'h.265'
    videoResolution: string | null; // '1080i' など
    videoStreamContent: number | null;
    videoComponentType: number | null;
    audioSamplingRate: number | null; // Hz
    audioComponentType: number | null;

    // --- PMT のストリーム構成 ---
    videoStreamType: number | null;
    videoPid: number | null;
    audioStreamType: number | null;
    audioPid: number | null;

    // --- TDT / TOT ---
    // ファイル先頭 (録画開始時刻) の放送時刻推定値 (UNIX 時刻・ミリ秒)。
    // TDT/TOT はファイル先頭からある程度離れた位置で初めて出現することがあるため、
    // 見つかった時点の時刻そのものではなく、PCR で測った経過時間ぶん遡って補正した値。
    // (PCR による補正ができなかった場合は、TDT/TOT がその時点で示していた時刻をそのまま使う)
    // ファイルの更新時刻からの推定より正確
    firstTdtAt: number | null;

    // --- BIT ---
    // 放送局の系列情報 (BIT を受信できなかった場合は空配列)
    bitSections: BitSectionInfo[];
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
