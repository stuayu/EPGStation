import * as aribts from 'aribts';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as stream from 'stream';
import BitParser from '../../channel/BitParser';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ChannelUtil from '../../../util/ChannelUtil';
import ITsInfoAnalyzer, { TsGenre, TsInfo, TsInfoAnalyzeOption } from './ITsInfoAnalyzer';

/**
 * PCR (Program Clock Reference) のサンプル 1 点
 */
interface PcrSample {
    pid: number;
    pcr: number;
    packetIndex: number;
    // PCR の時間軸の世代。adaptation_field.discontinuity_indicator で切り替わる。
    // 異なる epoch のサンプル同士は同じ時間軸に無いため差分を取ってはいけない
    epoch: number;
}

/**
 * extended_event_descriptor 1 個分。ARIB STD-B10 では 1 番組の詳細情報が
 * descriptor_number 0..last_descriptor_number へ分割して送出されるため、
 * 連結する前に 1 個ずつこの形で集めておく
 */
interface ExtendedEventPart {
    descriptorNumber: number;
    lastDescriptorNumber: number;
    languageCode: string | null;
    items: Array<{ description: string; value: string }>;
    text: string;
}

/**
 * EIT[p/f] present から作った番組情報の候補。
 * component_tag は PMT の stream_identifier_descriptor と突き合わせて
 * 代表映像・代表音声の ES を決めるために保持する
 */
interface EventCandidate {
    info: TsInfo;
    videoComponentTag: number | null;
    audioComponentTag: number | null;
}

/**
 * SDT の service_descriptor から取り出したサービス 1 件分
 */
interface SdtService {
    serviceType: number | null;
    name: string | null;
    provider: string | null;
}

/**
 * 1 区間分の解析結果。firstTdtAt は「読み出しを開始した位置の放送時刻」であって
 * 「ファイル先頭の放送時刻」ではない点に注意 (中央から読んだ場合は analyze() が補正する)
 */
interface ScanResult {
    info: TsInfo;
    // 読み出し開始位置に対応する放送時刻 (= 補正後の info.firstTdtAt)
    regionStartAt: number | null;
    // 区間内で実測した平均バイトレート (byte / ミリ秒)
    bytesPerMs: number | null;
    // 採用したサービスの PCR_PID
    pcrPid: number | null;
}

/**
 * TS ファイルの PSI/SI (PAT / SDT / NIT / EIT / TDT / PMT) を解析して
 * 放送局・番組・ストリーム構成の情報を取り出す
 *
 * 既定ではファイルの中央から読む。ファイル先頭は
 * 「前番組の EIT[p/f] がまだ present として流れている」「録画開始直後で TS が壊れている」
 * ことがあり、そのまま採用すると番組名・ジャンルが前番組のものになるため。
 * ファイル全体は読まず、必要なテーブルが揃うか上限に達した時点で打ち切る
 */
@injectable()
export default class TsInfoAnalyzer implements ITsInfoAnalyzer {
    // 解析のために読み込む既定の最大バイト数 (TDT / EIT[p/f] が一巡するには十分な量)
    private static readonly DEFAULT_MAX_READ_BYTES = 64 * 1024 * 1024;
    // 解析の既定の打ち切り時間
    private static readonly DEFAULT_TIMEOUT_MS = 60 * 1000;
    private static readonly JST_OFFSET_MS = 9 * 60 * 60 * 1000;

    private static readonly TS_PACKET_SIZE = 188;
    private static readonly SYNC_BYTE = 0x47;
    // ファイル中央から読むために必要な最小ファイルサイズ。
    // これ未満のファイルは中央から読んでも残りが短く、テーブルが一巡しないおそれがあるため先頭から読む
    private static readonly MIN_MIDDLE_ANALYZE_BYTES = 64 * 1024 * 1024;
    // 任意位置から TS パケット境界を探すために読むバイト数
    private static readonly SYNC_SEARCH_BYTES = TsInfoAnalyzer.TS_PACKET_SIZE * 20;
    // ファイル先頭の放送時刻 (TDT/TOT) を読むために先頭から読み込む最大バイト数。
    // TDT は 5 秒以下の周期で送出されるため通常はこれより遥かに手前で見つかり、その時点で打ち切る
    private static readonly HEAD_PROBE_MAX_BYTES = 32 * 1024 * 1024;
    // 平均バイトレートの実測に必要な最小の PCR 区間 (短すぎる区間は誤差が大きい)
    private static readonly MIN_BITRATE_SPAN_MS = 1000;
    // 相乗りしている複数サービスの中から対象を選ぶために最低限読むパケット数 (約 3.7MB)
    private static readonly MIN_PACKETS_FOR_SERVICE_SELECTION = 20000;
    // 対象サービスとして最優先する service_type (デジタルTVサービス / 超高精細度4K専用TVサービス)
    private static readonly PRIMARY_SERVICE_TYPES = [0x01, 0xad];

    // PCR (Program Clock Reference) の刻み (27MHz)
    private static readonly PCR_TICK_HZ = 27_000_000;
    // PCR (33bit base * 300 + 9bit extension) が一周してラップアラウンドするまでの周期
    private static readonly PCR_WRAP_TICKS = Math.pow(2, 33) * 300;
    // PCR_PID が未割り当てであることを示す予約値
    private static readonly PCR_PID_NONE = 0x1fff;
    // 保持する PCR サンプル数の安全上限 (メモリ保護。通常の解析範囲では遠く及ばない)
    private static readonly MAX_PCR_SAMPLES = 5000;
    // PCR による補正量の上限。TDT/TOT は通常数秒以内に見つかるため、
    // これを超える補正は壊れたストリーム等による誤検出とみなして適用しない
    private static readonly MAX_PCR_CORRECTION_MS = 2 * 60 * 1000;

    private static readonly TABLE_ID_NIT_ACTUAL = 0x40;
    private static readonly TABLE_ID_SDT_ACTUAL = 0x42;
    private static readonly TABLE_ID_EIT_PF_ACTUAL = 0x4e;

    private static readonly DESCRIPTOR_TAG_NETWORK_NAME = 0x40;
    private static readonly DESCRIPTOR_TAG_SERVICE = 0x48;
    private static readonly DESCRIPTOR_TAG_SHORT_EVENT = 0x4d;
    private static readonly DESCRIPTOR_TAG_EXTENDED_EVENT = 0x4e;
    private static readonly DESCRIPTOR_TAG_COMPONENT = 0x50;
    private static readonly DESCRIPTOR_TAG_CONTENT = 0x54;
    private static readonly DESCRIPTOR_TAG_AUDIO_COMPONENT = 0xc4;
    // PMT の ES 記述子。EIT の component_tag と PMT の ES を対応付けるために使う
    private static readonly DESCRIPTOR_TAG_STREAM_IDENTIFIER = 0x52;

    // component_descriptor の stream_content → 映像符号化方式 (Mirakurun の program.video.type と同じ表記)
    private static readonly STREAM_CONTENT: { [key: number]: string } = {
        0x01: 'mpeg2',
        0x05: 'h.264',
        0x09: 'h.265',
    };

    // component_descriptor の component_type → 映像解像度 (Mirakurun の program.video.resolution と同じ表記)
    private static readonly COMPONENT_TYPE_RESOLUTION: { [key: number]: string } = {
        0x01: '480i',
        0x02: '480i',
        0x03: '480i',
        0x04: '480i',
        0x83: '4320p',
        0x91: '2160p',
        0x92: '2160p',
        0x93: '2160p',
        0x94: '2160p',
        0xa1: '480p',
        0xa2: '480p',
        0xa3: '480p',
        0xa4: '480p',
        0xb1: '1080i',
        0xb2: '1080i',
        0xb3: '1080i',
        0xb4: '1080i',
        0xc1: '720p',
        0xc2: '720p',
        0xc3: '720p',
        0xc4: '720p',
        0xd1: '240p',
        0xd2: '240p',
        0xd3: '240p',
        0xd4: '240p',
        0xe1: '1080p',
        0xe2: '1080p',
        0xe3: '1080p',
        0xe4: '1080p',
        0xf1: '180p',
        0xf2: '180p',
        0xf3: '180p',
        0xf4: '180p',
    };

    // audio_component_descriptor の sampling_rate → サンプリング周波数 (Hz)。-1 は予約値
    private static readonly SAMPLING_RATE: { [key: number]: number } = {
        0: -1,
        1: 16000,
        2: 22050,
        3: 24000,
        4: -1,
        5: 32000,
        6: 44100,
        7: 48000,
    };

    // ジャンル未定義 (content_nibble_level_1 = 0xF)
    private static readonly GENRE_NIBBLE_UNDEFINED = 0x0f;

    // MPEG-2 Video / H.264 / H.265
    private static readonly VIDEO_STREAM_TYPES = [0x02, 0x1b, 0x24];
    // MPEG-2 AAC / MPEG-4 AAC
    private static readonly AUDIO_STREAM_TYPES = [0x0f, 0x11];

    private log: ILogger;

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * TS ファイルを解析する
     *
     * 既定ではファイルの中央から読む。ファイル先頭の EIT[p/f] は前番組を指していることがあり、
     * そのまま採用すると番組名・ジャンルが前番組のものになってしまうため。
     * ただし firstTdtAt (ファイル先頭の放送時刻) だけは先頭を読み直して求める
     * @param filePath: string 解析対象のファイルパス
     * @param option: TsInfoAnalyzeOption
     * @return Promise<TsInfo> 解析できなかった項目は null で返る
     */
    public async analyze(filePath: string, option?: TsInfoAnalyzeOption): Promise<TsInfo> {
        const maxReadBytes = option?.maxReadBytes ?? TsInfoAnalyzer.DEFAULT_MAX_READ_BYTES;
        const timeoutMs = option?.timeoutMs ?? TsInfoAnalyzer.DEFAULT_TIMEOUT_MS;

        const startPosition = await this.decideStartPosition(filePath, option);
        const result = await this.scan(filePath, startPosition, maxReadBytes, timeoutMs, option?.expectedServiceId);

        if (startPosition > 0) {
            result.info.firstTdtAt = await this.resolveFileStartAt(filePath, startPosition, result, timeoutMs);
        }

        return result.info;
    }

    /**
     * 解析の読み出し開始位置を決める。
     * 中央から読む場合は TS パケット境界へ丸める (境界がずれると先頭のパケットを取りこぼす)
     * @param filePath: string
     * @param option: TsInfoAnalyzeOption | undefined
     * @return Promise<number> ファイル先頭からのバイト位置 (0 なら先頭から読む)
     */
    private async decideStartPosition(filePath: string, option?: TsInfoAnalyzeOption): Promise<number> {
        if (option?.analyzeFromMiddle === false) {
            return 0;
        }

        const size = await fs.promises
            .stat(filePath)
            .then(stat => stat.size)
            .catch(() => null);
        if (size === null || size < TsInfoAnalyzer.MIN_MIDDLE_ANALYZE_BYTES) {
            return 0;
        }

        const middle = Math.floor(size / 2);

        return await this.findPacketBoundary(filePath, middle - (middle % TsInfoAnalyzer.TS_PACKET_SIZE));
    }

    /**
     * 指定位置の近くにある TS パケット境界 (sync_byte が 188 byte 間隔で並ぶ位置) を探す
     * @param filePath: string
     * @param position: number 探索を始めるバイト位置
     * @return Promise<number> 見つからない場合は position をそのまま返す
     */
    private async findPacketBoundary(filePath: string, position: number): Promise<number> {
        const handle = await fs.promises.open(filePath, 'r').catch(() => null);
        if (handle === null) {
            return position;
        }

        try {
            const buffer = Buffer.alloc(TsInfoAnalyzer.SYNC_SEARCH_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            const limit = bytesRead - TsInfoAnalyzer.TS_PACKET_SIZE * 2;
            for (let i = 0; i < limit; i++) {
                if (
                    buffer[i] === TsInfoAnalyzer.SYNC_BYTE &&
                    buffer[i + TsInfoAnalyzer.TS_PACKET_SIZE] === TsInfoAnalyzer.SYNC_BYTE &&
                    buffer[i + TsInfoAnalyzer.TS_PACKET_SIZE * 2] === TsInfoAnalyzer.SYNC_BYTE
                ) {
                    return position + i;
                }
            }

            return position;
        } catch (err: any) {
            return position;
        } finally {
            await handle.close().catch(() => {});
        }
    }

    /**
     * 指定位置から TS を読んで PSI/SI を解析する
     * @param filePath: string
     * @param startPosition: number 読み出し開始位置 (バイト)
     * @param maxReadBytes: number 読み込む最大バイト数
     * @param timeoutMs: number 打ち切り時間
     * @return Promise<ScanResult>
     */
    private scan(
        filePath: string,
        startPosition: number,
        maxReadBytes: number,
        timeoutMs: number,
        expectedServiceId?: number,
    ): Promise<ScanResult> {
        return new Promise<ScanResult>(resolve => {
            const info: TsInfo = TsInfoAnalyzer.createEmptyInfo();
            // SDT / EIT / PMT は全サービス分流れてくるため、対象サービスを決めるまでは候補として保持する
            const sdtServices = new Map<number, SdtService>();
            const pmtStreams = new Map<number, aribts.Stream[]>();
            // program_number -> PCR_PID (TDT/TOT の時刻補正に使う)
            const pmtPcrPids = new Map<number, number>();
            // service_id -> EIT[p/f] present から作った番組情報の候補
            const eitCandidates = new Map<number, EventCandidate>();
            // PID ごとのパケット数。どのサービスが実際にデータを流しているか (= 録画対象か) の判定に使う
            const pidPacketCounts = new Map<number, number>();
            let patServiceIds: number[] = [];
            let isFinished = false;

            // PCR による TDT/TOT 時刻の補正用: 受信したパケット数 (= 読み出し開始位置からの相対位置) と、
            // PID ごとの PCR サンプル (読み出し開始位置からの経過時間を測るための基準点)
            let packetIndex = 0;
            const pcrSamples: PcrSample[] = [];
            // PID ごとの PCR 時間軸の世代 (discontinuity_indicator で切り替わる)
            const pcrEpochs = new Map<number, number>();
            // 最初に確定した TDT/TOT が見つかった時点でのパケット位置
            let firstTdtPacketIndex: number | null = null;

            const readableStream = fs.createReadStream(filePath, {
                start: startPosition,
                end: startPosition + Math.max(1, maxReadBytes) - 1,
            });
            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser();
            const tsSectionParser = new aribts.TsSectionParser();
            const bitParser = new BitParser();

            const finish = (): void => {
                if (isFinished === true) {
                    return;
                }
                isFinished = true;
                clearTimeout(timer);

                const result: ScanResult = { info: info, regionStartAt: null, bytesPerMs: null, pcrPid: null };

                // 相乗りしているサービスの中から録画対象のサービスを選ぶ
                info.serviceId = TsInfoAnalyzer.selectServiceId(
                    patServiceIds,
                    sdtServices,
                    pmtStreams,
                    pmtPcrPids,
                    eitCandidates,
                    pidPacketCounts,
                    expectedServiceId,
                );

                if (
                    typeof expectedServiceId === 'number' &&
                    info.serviceId !== null &&
                    info.serviceId !== expectedServiceId
                ) {
                    // 呼び出し側が録画対象として把握している service_id が TS の中に見つからなかった場合。
                    // 仕様上一意に決まらないので heuristic へ落ちたことを残す
                    this.log.system.warn(
                        `expected service id ${expectedServiceId} was not found in TS; fallback service selection used: ${filePath}`,
                    );
                }

                if (info.serviceId !== null) {
                    // 対象サービスの SDT 情報を反映する
                    const service = sdtServices.get(info.serviceId);
                    if (typeof service !== 'undefined') {
                        info.serviceType = service.serviceType;
                        info.serviceName = service.name;
                        info.serviceProviderName = service.provider;
                    }

                    // 対象サービスの EIT[p/f] present を反映する
                    // (PMT より先に反映するのは、EIT の component_tag を使って
                    //  PMT の代表映像・代表音声 ES を選ぶため)
                    const event = eitCandidates.get(info.serviceId);
                    if (typeof event !== 'undefined') {
                        TsInfoAnalyzer.applyEventCandidate(info, event.info);
                    }

                    const streams = pmtStreams.get(info.serviceId);
                    if (typeof streams !== 'undefined') {
                        TsInfoAnalyzer.setStreamInfo(
                            info,
                            streams,
                            event?.videoComponentTag ?? null,
                            event?.audioComponentTag ?? null,
                        );
                    }

                    const pcrPid = pmtPcrPids.get(info.serviceId);
                    if (typeof pcrPid === 'number' && pcrPid !== TsInfoAnalyzer.PCR_PID_NONE) {
                        result.pcrPid = pcrPid;

                        // TDT/TOT で得た時刻を、実際に見つかった位置 (読み出し開始位置からの経過時間) の
                        // 分だけ遡って補正する。PCR サンプルが足りない等で補正できない場合は
                        // 無補正の値のまま使う
                        if (info.firstTdtAt !== null && firstTdtPacketIndex !== null) {
                            const corrected = TsInfoAnalyzer.correctStartAtByPcr(
                                info.firstTdtAt,
                                firstTdtPacketIndex,
                                pcrPid,
                                pcrSamples,
                            );
                            if (corrected !== null) {
                                info.firstTdtAt = corrected;
                            }
                        }

                        result.bytesPerMs = TsInfoAnalyzer.calcBytesPerMs(pcrPid, pcrSamples);
                    }
                }

                result.regionStartAt = info.firstTdtAt;

                readableStream.unpipe();
                readableStream.destroy();
                resolve(result);
            };

            // 必要な情報がそろっていれば残りは読まずに打ち切る
            const checkFinish = (): void => {
                if (
                    TsInfoAnalyzer.hasEnoughInfo(
                        info,
                        packetIndex,
                        patServiceIds,
                        sdtServices,
                        pmtStreams,
                        pmtPcrPids,
                        eitCandidates,
                        pidPacketCounts,
                        expectedServiceId,
                    )
                ) {
                    finish();
                }
            };

            const timer = setTimeout(() => {
                this.log.system.warn(`ts info analyze timeout: ${filePath}`);
                finish();
            }, timeoutMs);

            // PAT: transport_stream_id と、この TS に含まれるサービス一覧
            tsSectionParser.on('pat', (section: aribts.TsSectionProgramAssociation) => {
                try {
                    const pat = section.decode();
                    info.transportStreamId = pat.transport_stream_id;
                    patServiceIds = pat.programs.filter(p => p.program_number !== 0).map(p => p.program_number);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            // SDT: 放送局名 (service_descriptor) と original_network_id
            tsSectionParser.on('sdt', (section: aribts.TsSectionServiceDescription) => {
                try {
                    const sdt = section.decode();
                    if (sdt.table_id !== TsInfoAnalyzer.TABLE_ID_SDT_ACTUAL) {
                        // 他 TS のサービス情報は使わない
                        return;
                    }
                    info.networkId = sdt.original_network_id;
                    info.transportStreamId = sdt.transport_stream_id;

                    for (const service of sdt.services) {
                        for (const descriptor of service.descriptors.decode()) {
                            const d = descriptor.decode();
                            if (d.descriptor_tag !== TsInfoAnalyzer.DESCRIPTOR_TAG_SERVICE) {
                                continue;
                            }
                            sdtServices.set(service.service_id, {
                                serviceType: typeof d.service_type === 'number' ? d.service_type : null,
                                name: TsInfoAnalyzer.decodeChar(d.service_name),
                                provider: TsInfoAnalyzer.decodeChar(d.service_provider_name),
                            });
                        }
                    }
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }

                checkFinish();
            });

            // NIT: ネットワーク名
            tsSectionParser.on('nit', (section: aribts.TsSectionNetworkInformation) => {
                try {
                    const nit = section.decode();
                    if (nit.table_id !== TsInfoAnalyzer.TABLE_ID_NIT_ACTUAL || info.networkName !== null) {
                        return;
                    }
                    for (const descriptor of nit.descriptors.decode()) {
                        const d = descriptor.decode();
                        if (d.descriptor_tag === TsInfoAnalyzer.DESCRIPTOR_TAG_NETWORK_NAME) {
                            info.networkName = TsInfoAnalyzer.decodeChar(d.network_name ?? d.char);
                        }
                    }
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            // PMT: 映像・音声のストリーム構成
            tsSectionParser.on('pmt', (section: aribts.TsSectionProgramMap) => {
                try {
                    const pmt = section.decode();
                    pmtStreams.set(pmt.program_number, pmt.streams);
                    pmtPcrPids.set(pmt.program_number, pmt.PCR_PID);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }

                checkFinish();
            });

            // EIT[p/f] present: 録画された番組そのものの情報。
            // 同一 TS の全サービス分が流れてくるため、サービスごとに候補として保持し、
            // どれを採用するかは finish() のサービス選択で決める
            tsSectionParser.on('eit', (section: aribts.TsSectionEventInformation) => {
                try {
                    const eit = section.decode();
                    // 自ストリームの present (section 0) のみ採用する。
                    // current_next_indicator = 0 は「次に適用される内容」なので現在の番組ではない
                    if (
                        eit.table_id !== TsInfoAnalyzer.TABLE_ID_EIT_PF_ACTUAL ||
                        eit.section_number !== 0 ||
                        eit.current_next_indicator !== 1
                    ) {
                        return;
                    }
                    if (eitCandidates.has(eit.service_id) === true) {
                        return;
                    }
                    const event = eit.events[0];
                    if (typeof event === 'undefined') {
                        return;
                    }

                    // PAT に載っているサービス (サービス指定で録画されたファイルでは対象サービスのみ) 以外は採用しない
                    if (patServiceIds.length > 0 && patServiceIds.includes(eit.service_id) === false) {
                        return;
                    }

                    const info2 = TsInfoAnalyzer.createEmptyInfo();
                    info2.serviceId = eit.service_id;
                    info2.networkId = eit.original_network_id;
                    info2.transportStreamId = eit.transport_stream_id;

                    info2.eventId = event.event_id;
                    info2.eventStartAt = TsInfoAnalyzer.decodeJstDate(event.start_time);
                    info2.eventDuration = TsInfoAnalyzer.decodeBcdDuration(event.duration);

                    const candidate: EventCandidate = {
                        info: info2,
                        videoComponentTag: null,
                        audioComponentTag: null,
                    };
                    TsInfoAnalyzer.setEventDescriptors(candidate, event.descriptors);
                    eitCandidates.set(eit.service_id, candidate);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }

                checkFinish();
            });

            // TDT / TOT: 放送時刻。ただし TDT/TOT はファイル先頭からある程度離れた位置で
            // 初めて出現することがあるため、ここで得た時刻は「見つかった瞬間の放送時刻」であって
            // 「ファイル先頭の時刻」そのものではない。実際の経過時間は finish() 側で PCR を使って
            // 補正する (firstTdtPacketIndex にこの時点でのパケット位置を控えておく)。
            // TOT は TDT と同じ PID (0x14) で流れ、日本の放送では両方送出される
            const onTimeTable = (jstTime: unknown): void => {
                if (info.firstTdtAt === null) {
                    const decoded = TsInfoAnalyzer.decodeJstDate(jstTime);
                    if (decoded !== null) {
                        info.firstTdtAt = decoded;
                        firstTdtPacketIndex = packetIndex;
                    }
                }

                checkFinish();
            };

            tsSectionParser.on('tdt', (section: aribts.TsSectionTimeAndDate) => {
                try {
                    onTimeTable(section.decode().JST_time);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            tsSectionParser.on('tot', (section: aribts.TsSectionTimeOffset) => {
                try {
                    onTimeTable(section.decode().JST_time);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            // PCR (Program Clock Reference) サンプリングと PID ごとのパケット数集計。
            // tsSectionParser とは別に生パケットを直接覗き見る (pipe の消費とは独立に動く追加の
            // 'data' リスナーとして安全に併存できる。ストリームの分岐・消費はしない)
            tsPacketParser.on('data', (packet: aribts.TsPacket) => {
                const currentIndex = packetIndex++;

                try {
                    const pid = packet.getPid();
                    pidPacketCounts.set(pid, (pidPacketCounts.get(pid) ?? 0) + 1);
                } catch (err: any) {
                    // 壊れたパケットは無視して読み進める
                }

                if (pcrSamples.length >= TsInfoAnalyzer.MAX_PCR_SAMPLES) {
                    return;
                }

                try {
                    if (packet.getPcrFlag() !== 1) {
                        return;
                    }

                    const decoded = packet.decode();
                    const af = decoded.adaptation_field;
                    if (
                        typeof af === 'undefined' ||
                        af === null ||
                        typeof af.program_clock_reference_base !== 'number' ||
                        typeof af.program_clock_reference_extension !== 'number'
                    ) {
                        return;
                    }

                    const pid = packet.getPid();
                    // discontinuity_indicator = 1 のパケットが運ぶ PCR は新しい時間軸の起点。
                    // 以降のサンプルは別 epoch として扱い、epoch をまたいだ差分計算をしない
                    // (ARIB / ISO 13818-1: TS の連結・録画ドロップ・エンコーダ再起動で発生する)
                    if (af.discontinuity_indicator === 1) {
                        pcrEpochs.set(pid, (pcrEpochs.get(pid) ?? 0) + 1);
                    }

                    pcrSamples.push({
                        pid: pid,
                        pcr: af.program_clock_reference_base * 300 + af.program_clock_reference_extension,
                        packetIndex: currentIndex,
                        epoch: pcrEpochs.get(pid) ?? 0,
                    });
                } catch (err: any) {
                    // 壊れたパケットは無視して読み進める
                }
            });

            readableStream.pipe(tsReadableConnector as unknown as stream.Writable);
            tsReadableConnector.pipe(tsPacketParser as any);
            tsPacketParser.pipe(tsSectionParser);

            // BIT (PID 0x0024) は aribts の TsSectionParser が扱わないため、
            // 生のチャンクを追加の 'data' リスナーで覗いて自前で解析する
            // (pipe の消費とは独立に動くため、ストリームの分岐・消費はしない)
            readableStream.on('data', chunk => {
                try {
                    const sections = bitParser.write(chunk as Buffer);
                    if (sections.length > 0) {
                        info.bitSections = info.bitSections.concat(sections);
                    }
                } catch (err: any) {
                    // 壊れたパケットは無視して読み進める
                }
            });

            readableStream.on('error', err => {
                this.log.system.error(`ts info analyze read error: ${filePath}`);
                this.log.system.error(err.message);
                finish();
            });
            readableStream.on('end', () => {
                finish();
            });
            readableStream.on('close', () => {
                finish();
            });
        });
    }

    /**
     * 解析を打ち切ってよいだけの情報が集まったか
     * 対象サービスの局名・番組・時刻・ストリーム構成がそろっていればファイルの残りを読む必要はない
     */
    private static hasEnoughInfo(
        info: TsInfo,
        packetCount: number,
        patServiceIds: number[],
        sdtServices: Map<number, SdtService>,
        pmtStreams: Map<number, aribts.Stream[]>,
        pmtPcrPids: Map<number, number>,
        eitCandidates: Map<number, EventCandidate>,
        pidPacketCounts: Map<number, number>,
        expectedServiceId?: number,
    ): boolean {
        if (info.firstTdtAt === null) {
            return false;
        }

        // サービスが相乗りしている TS の選択はパケット数の偏り (どのサービスが実際にデータを
        // 流しているか) を見るため、判断が安定するだけの量を読むまでは打ち切らない。
        // サービス指定で録画されたファイル (PAT に 1 サービスしか無い) は選択に迷わないので待たない
        // 対象サービスが呼び出し側から指定されている場合も、そのサービスの情報がそろえば打ち切ってよい
        const isServiceDecided =
            patServiceIds.length === 1 ||
            (typeof expectedServiceId === 'number' && pmtStreams.has(expectedServiceId) === true);
        if (isServiceDecided === false && packetCount < TsInfoAnalyzer.MIN_PACKETS_FOR_SERVICE_SELECTION) {
            return false;
        }

        const serviceId = TsInfoAnalyzer.selectServiceId(
            patServiceIds,
            sdtServices,
            pmtStreams,
            pmtPcrPids,
            eitCandidates,
            pidPacketCounts,
            expectedServiceId,
        );
        if (serviceId === null) {
            return false;
        }

        return sdtServices.has(serviceId) && pmtStreams.has(serviceId) && eitCandidates.has(serviceId);
    }

    /**
     * 相乗りしている複数サービスの中から、この録画ファイルの対象サービスを選ぶ。
     *
     * 全サービス録画の TS には主番組・サブチャンネル・ワンセグ・データ放送が同居しており、
     * 単純に PAT の先頭や最初に見つかった EIT[p/f] を採ると、ワンセグやサブチャンネルの
     * 放送局名・番組名を拾ってしまう。実際にデータが流れている量 (PID ごとのパケット数) と
     * service_type を見て、主番組を選ぶ
     *
     * @param patServiceIds: number[] PAT に載っているサービス
     * @param sdtServices: Map<number, SdtService>
     * @param pmtStreams: Map<number, aribts.Stream[]>
     * @param pmtPcrPids: Map<number, number>
     * @param eitCandidates: Map<number, EventCandidate>
     * @param pidPacketCounts: Map<number, number>
     * @param expectedServiceId: number | undefined 呼び出し側が把握している録画対象の service_id
     * @return number | null 候補が無い場合は null
     */
    private static selectServiceId(
        patServiceIds: number[],
        sdtServices: Map<number, SdtService>,
        pmtStreams: Map<number, aribts.Stream[]>,
        pmtPcrPids: Map<number, number>,
        eitCandidates: Map<number, EventCandidate>,
        pidPacketCounts: Map<number, number>,
        expectedServiceId?: number,
    ): number | null {
        // PAT が読めていればそれが対象候補の正。読めていない場合は他のテーブルから拾う
        const candidates =
            patServiceIds.length > 0
                ? patServiceIds
                : Array.from(
                      new Set<number>([...pmtStreams.keys(), ...eitCandidates.keys(), ...sdtServices.keys()]),
                  ).sort((a, b) => a - b);

        // 呼び出し側が録画対象の service_id を知っている場合はそれが正。
        // 以降のパケット数・service_type による推定は、あくまで手掛かりが無いときの代替手段
        if (typeof expectedServiceId === 'number') {
            if (
                candidates.includes(expectedServiceId) === true ||
                pmtStreams.has(expectedServiceId) === true ||
                sdtServices.has(expectedServiceId) === true
            ) {
                return expectedServiceId;
            }
        }

        if (candidates.length === 0) {
            return null;
        }
        if (candidates.length === 1) {
            return candidates[0];
        }

        let best: { serviceId: number; rank: number; packets: number; hasEit: boolean } | null = null;
        for (const serviceId of candidates) {
            const current = {
                serviceId: serviceId,
                rank: TsInfoAnalyzer.getServiceTypeRank(sdtServices.get(serviceId)?.serviceType ?? null),
                packets: TsInfoAnalyzer.countServicePackets(serviceId, pmtStreams, pmtPcrPids, pidPacketCounts),
                hasEit: eitCandidates.has(serviceId),
            };

            if (
                best === null ||
                current.rank > best.rank ||
                (current.rank === best.rank &&
                    (current.packets > best.packets ||
                        (current.packets === best.packets &&
                            ((current.hasEit === true && best.hasEit === false) ||
                                (current.hasEit === best.hasEit && current.serviceId < best.serviceId)))))
            ) {
                best = current;
            }
        }

        return best === null ? null : best.serviceId;
    }

    /**
     * service_type の優先度。数字が大きいほど「録画対象になりうる本編サービス」
     * @param serviceType: number | null SDT が読めていない場合は null
     */
    private static getServiceTypeRank(serviceType: number | null): number {
        if (serviceType === null) {
            // SDT がまだ読めていないサービス。データ放送より上・本編より下に置く
            return 1;
        }
        if (TsInfoAnalyzer.PRIMARY_SERVICE_TYPES.includes(serviceType) === true) {
            return 2;
        }

        // 臨時・プロモーション・音声サービスは本編の次点。ワンセグ・データ放送は最下位
        return ChannelUtil.isMediaService(serviceType) === true ? 1 : 0;
    }

    /**
     * サービスが流したパケット数 (PMT が指す ES と PCR の合計) を数える
     */
    private static countServicePackets(
        serviceId: number,
        pmtStreams: Map<number, aribts.Stream[]>,
        pmtPcrPids: Map<number, number>,
        pidPacketCounts: Map<number, number>,
    ): number {
        const streams = pmtStreams.get(serviceId);
        if (typeof streams === 'undefined') {
            return 0;
        }

        const pids = new Set<number>(streams.map(s => s.elementary_PID));
        const pcrPid = pmtPcrPids.get(serviceId);
        if (typeof pcrPid === 'number' && pcrPid !== TsInfoAnalyzer.PCR_PID_NONE) {
            pids.add(pcrPid);
        }

        let packets = 0;
        for (const pid of pids) {
            packets += pidPacketCounts.get(pid) ?? 0;
        }

        return packets;
    }

    /**
     * 選ばれたサービスの EIT[p/f] 候補を解析結果へ写す
     */
    private static applyEventCandidate(info: TsInfo, candidate: TsInfo): void {
        info.networkId = candidate.networkId ?? info.networkId;
        info.transportStreamId = candidate.transportStreamId ?? info.transportStreamId;

        info.eventId = candidate.eventId;
        info.eventName = candidate.eventName;
        info.eventDescription = candidate.eventDescription;
        info.eventExtended = candidate.eventExtended;
        info.eventStartAt = candidate.eventStartAt;
        info.eventDuration = candidate.eventDuration;
        info.genres = candidate.genres;
        info.videoType = candidate.videoType;
        info.videoResolution = candidate.videoResolution;
        info.videoStreamContent = candidate.videoStreamContent;
        info.videoComponentType = candidate.videoComponentType;
        info.audioSamplingRate = candidate.audioSamplingRate;
        info.audioComponentType = candidate.audioComponentType;
    }

    /**
     * EIT の記述子から番組名・概要・詳細・ジャンル・代表映像/音声を取り出す
     *
     * ARIB STD-B10 で規定されている以下を扱う
     * - short_event_descriptor (0x4D): 番組名・概要
     * - extended_event_descriptor (0x4E): 詳細情報 (descriptor_number で分割送出される)
     * - content_descriptor (0x54): ジャンル
     * - component_descriptor (0x50): 映像コンポーネント
     * - audio_component_descriptor (0xC4): 音声コンポーネント
     * @param candidate: EventCandidate
     * @param descriptors: aribts.TsDescriptors
     */
    private static setEventDescriptors(candidate: EventCandidate, descriptors: aribts.TsDescriptors): void {
        const info = candidate.info;
        // extended_event_descriptor は分割されるため、いったんそのまま集めてから連結する
        const extendedParts: ExtendedEventPart[] = [];
        // component_descriptor / audio_component_descriptor も複数流れる
        const videoComponents: Array<{
            streamContent: number | null;
            componentType: number | null;
            tag: number | null;
        }> = [];
        const audioComponents: Array<{
            componentType: number | null;
            samplingRate: number | null;
            tag: number | null;
            isMain: boolean;
        }> = [];

        for (const descriptor of descriptors.decode()) {
            let d: aribts.Descriptor;
            try {
                d = descriptor.decode();
            } catch (err: any) {
                // 壊れた記述子が 1 つあっても他の記述子は捨てない
                continue;
            }

            try {
                switch (d.descriptor_tag) {
                    case TsInfoAnalyzer.DESCRIPTOR_TAG_SHORT_EVENT:
                        info.eventName = TsInfoAnalyzer.decodeChar(d.event_name);
                        info.eventDescription = TsInfoAnalyzer.decodeChar(d.text);
                        break;
                    case TsInfoAnalyzer.DESCRIPTOR_TAG_EXTENDED_EVENT:
                        extendedParts.push({
                            descriptorNumber: typeof d.descriptor_number === 'number' ? d.descriptor_number : 0,
                            lastDescriptorNumber:
                                typeof d.last_descriptor_number === 'number' ? d.last_descriptor_number : 0,
                            languageCode: TsInfoAnalyzer.decodeLanguageCode(d.ISO_639_language_code),
                            items: (d.items ?? []).map((item: { item_description: unknown; item: unknown }) => ({
                                description: TsInfoAnalyzer.decodeChar(item.item_description) ?? '',
                                value: TsInfoAnalyzer.decodeChar(item.item) ?? '',
                            })),
                            text: TsInfoAnalyzer.decodeChar(d.text) ?? '',
                        });
                        break;
                    case TsInfoAnalyzer.DESCRIPTOR_TAG_CONTENT:
                        info.genres = (d.contents ?? [])
                            .map((c: { content_nibble_level_1: number; content_nibble_level_2: number }): TsGenre => ({
                                lv1: c.content_nibble_level_1,
                                lv2: c.content_nibble_level_2,
                            }))
                            .filter((g: TsGenre) => g.lv1 !== TsInfoAnalyzer.GENRE_NIBBLE_UNDEFINED);
                        break;
                    case TsInfoAnalyzer.DESCRIPTOR_TAG_COMPONENT:
                        videoComponents.push({
                            streamContent: d.stream_content ?? null,
                            componentType: d.component_type ?? null,
                            tag: typeof d.component_tag === 'number' ? d.component_tag : null,
                        });
                        break;
                    case TsInfoAnalyzer.DESCRIPTOR_TAG_AUDIO_COMPONENT: {
                        const samplingRate = TsInfoAnalyzer.SAMPLING_RATE[d.sampling_rate] ?? -1;
                        audioComponents.push({
                            componentType: d.component_type ?? null,
                            samplingRate: samplingRate > 0 ? samplingRate : null,
                            tag: typeof d.component_tag === 'number' ? d.component_tag : null,
                            isMain: d.main_component_flag === 1,
                        });
                        break;
                    }
                    default:
                        break;
                }
            } catch (err: any) {
                // 記述子 1 つの内容が壊れていても全体は捨てない
            }
        }

        info.eventExtended = TsInfoAnalyzer.buildExtendedEvent(extendedParts);

        // 映像は EPGStation が持てる代表 1 本のみ。EIT の並び順は保証されないため先頭を代表とする
        const video = videoComponents[0];
        if (typeof video !== 'undefined') {
            info.videoStreamContent = video.streamContent;
            info.videoComponentType = video.componentType;
            info.videoType =
                video.streamContent === null ? null : (TsInfoAnalyzer.STREAM_CONTENT[video.streamContent] ?? null);
            info.videoResolution =
                video.componentType === null
                    ? null
                    : (TsInfoAnalyzer.COMPONENT_TYPE_RESOLUTION[video.componentType] ?? null);
            candidate.videoComponentTag = video.tag;
        }

        // 音声は二か国語・解説音声などが並ぶため、main_component_flag = 1 (主音声) を優先する。
        // 立っているものが無い場合のみ先頭を代表とする (fallback)
        const audio = audioComponents.find(a => a.isMain === true) ?? audioComponents[0];
        if (typeof audio !== 'undefined') {
            info.audioComponentType = audio.componentType;
            info.audioSamplingRate = audio.samplingRate;
            candidate.audioComponentTag = audio.tag;
        }
    }

    /**
     * 分割送出された extended_event_descriptor を 1 つの詳細情報へ組み立てる。
     *
     * ARIB STD-B10 では 1 番組の詳細情報が descriptor_number 0..last_descriptor_number に
     * 分割される。項目名 (item_description) が空の item は直前の項目の続きであり、
     * 末尾の text_char (d.text) も詳細情報の一部なので落とさない。
     * 受信順は保証されないため descriptor_number で並べ替えてから連結する。
     * 言語が複数ある場合は混ぜず、jpn を優先して 1 言語分だけ採用する
     * @param parts: ExtendedEventPart[]
     * @return string | null 1 件も無い場合は null
     */
    private static buildExtendedEvent(parts: ExtendedEventPart[]): string | null {
        if (parts.length === 0) {
            return null;
        }

        const languages = Array.from(new Set(parts.map(p => p.languageCode ?? '')));
        // 日本の地上デジタル放送は jpn だが、仕様としては他言語もありうるので固定はしない
        const language = languages.includes('jpn') === true ? 'jpn' : languages[0];
        const targets = parts
            .filter(p => (p.languageCode ?? '') === language)
            .sort((a, b) => a.descriptorNumber - b.descriptorNumber);

        const items: Array<{ description: string; value: string }> = [];
        let text = '';
        for (const part of targets) {
            for (const item of part.items) {
                const last = items[items.length - 1];
                // 項目名が空の item は直前の項目の続き (分割された項目の後半)
                if (item.description === '' && typeof last !== 'undefined') {
                    last.value += item.value;
                } else {
                    items.push({ description: item.description, value: item.value });
                }
            }
            text += part.text;
        }

        const blocks = items.map(item => `${item.description}\n${item.value}`);
        if (text !== '') {
            blocks.push(text);
        }

        return blocks.length === 0 ? null : blocks.join('\n\n');
    }

    /**
     * PMT のストリーム一覧から映像・音声の代表 1 本ずつを拾う。
     *
     * ARIB STD-B10 では EIT の component_descriptor / audio_component_descriptor が持つ
     * component_tag と、PMT の各 ES が持つ stream_identifier_descriptor の component_tag が
     * 対応する。代表として選ぶべき ES は EIT 側が示しているため、まず component_tag で引き当て、
     * 引けなかった場合のみ stream_type が一致する先頭の ES を採る (fallback)
     * @param info: TsInfo
     * @param streams: aribts.Stream[]
     * @param videoComponentTag: number | null EIT の component_descriptor.component_tag
     * @param audioComponentTag: number | null EIT の audio_component_descriptor.component_tag
     */
    private static setStreamInfo(
        info: TsInfo,
        streams: aribts.Stream[],
        videoComponentTag: number | null = null,
        audioComponentTag: number | null = null,
    ): void {
        const video =
            TsInfoAnalyzer.findStreamByComponentTag(streams, TsInfoAnalyzer.VIDEO_STREAM_TYPES, videoComponentTag) ??
            streams.find(s => TsInfoAnalyzer.VIDEO_STREAM_TYPES.includes(s.stream_type));
        if (typeof video !== 'undefined') {
            info.videoStreamType = video.stream_type;
            info.videoPid = video.elementary_PID;
        }

        const audio =
            TsInfoAnalyzer.findStreamByComponentTag(streams, TsInfoAnalyzer.AUDIO_STREAM_TYPES, audioComponentTag) ??
            streams.find(s => TsInfoAnalyzer.AUDIO_STREAM_TYPES.includes(s.stream_type));
        if (typeof audio !== 'undefined') {
            info.audioStreamType = audio.stream_type;
            info.audioPid = audio.elementary_PID;
        }
    }

    /**
     * PMT の ES の中から stream_identifier_descriptor の component_tag が一致するものを探す
     * @param streams: aribts.Stream[]
     * @param streamTypes: number[] 対象とする stream_type
     * @param componentTag: number | null EIT 側の component_tag (null なら引き当てない)
     * @return aribts.Stream | null 見つからない場合は null
     */
    private static findStreamByComponentTag(
        streams: aribts.Stream[],
        streamTypes: number[],
        componentTag: number | null,
    ): aribts.Stream | null {
        if (componentTag === null) {
            return null;
        }

        for (const s of streams) {
            if (streamTypes.includes(s.stream_type) === false) {
                continue;
            }
            if (TsInfoAnalyzer.getComponentTag(s) === componentTag) {
                return s;
            }
        }

        return null;
    }

    /**
     * PMT の ES 記述子から stream_identifier_descriptor の component_tag を取り出す
     * @param es: aribts.Stream
     * @return number | null 持たない場合は null
     */
    private static getComponentTag(es: aribts.Stream): number | null {
        try {
            for (const descriptor of es.ES_info.decode()) {
                const d = descriptor.decode();
                if (d.descriptor_tag === TsInfoAnalyzer.DESCRIPTOR_TAG_STREAM_IDENTIFIER) {
                    return typeof d.component_tag === 'number' ? d.component_tag : null;
                }
            }
        } catch (err: any) {
            // 壊れた記述子は無視する
        }

        return null;
    }

    /**
     * TDT/TOT で得た時刻を、PCR (27MHz) で測った実経過時間を使って
     * 「ファイル先頭 (最初に PCR が現れた位置) の時刻」へ補正する。
     *
     * TDT/TOT は必ずしもファイル先頭にあるとは限らず、数百 ms 〜 数秒後に初めて
     * 出現することがある。その分を無補正のまま採用すると、その分だけ startAt が
     * 実際の録画開始より遅れて記録されてしまう。PCR は TDT/TOT よりずっと高頻度に
     * 送出されるため、対象 PID (PMT の PCR_PID) の PCR サンプルを使い、
     * 「ファイル先頭付近の PCR」と「TDT/TOT が見つかった位置以前で最も近い PCR」の
     * 差分から実経過時間を求め、TDT/TOT の時刻から差し引く。
     *
     * @param tdtAt: number 補正前の TDT/TOT 由来の時刻 (UNIX 時刻・ミリ秒)
     * @param tdtPacketIndex: number その TDT/TOT が見つかった時点でのパケット位置
     * @param pcrPid: number 対象サービスの PCR_PID
     * @param pcrSamples: 収集した PCR サンプル (PID 混在)
     * @return number | null 補正できない場合は null (呼び出し側は無補正の値を使う)
     */
    private static correctStartAtByPcr(
        tdtAt: number,
        tdtPacketIndex: number,
        pcrPid: number,
        pcrSamples: PcrSample[],
    ): number | null {
        const pidSamples = pcrSamples.filter(s => s.pid === pcrPid);
        if (pidSamples.length < 2) {
            // 基準点 (ファイル先頭付近) と終点 (TDT/TOT 付近) の 2 点がそろわないと測れない
            return null;
        }

        // ファイル先頭に最も近い (最小 packetIndex) サンプルを起点とする
        let first = pidSamples[0];
        for (const s of pidSamples) {
            if (s.packetIndex < first.packetIndex) {
                first = s;
            }
        }

        // 起点と同じ時間軸 (epoch) のサンプルだけを使う。PCR が不連続になった後のサンプルは
        // 別の時間軸なので、差分を取っても経過時間にはならない
        const samples = pidSamples.filter(s => s.epoch === first.epoch);

        // TDT/TOT が見つかった位置以前で、最も近いサンプルを終点とする
        let nearest: PcrSample | null = null;
        for (const s of samples) {
            if (s.packetIndex <= tdtPacketIndex && (nearest === null || s.packetIndex > nearest.packetIndex)) {
                nearest = s;
            }
        }
        if (nearest === null || nearest.packetIndex === first.packetIndex) {
            // TDT/TOT より前に (起点と同じ時間軸で、かつ起点と別の) PCR サンプルが無く、経過時間を測れない
            return null;
        }

        let deltaTicks = nearest.pcr - first.pcr;
        if (deltaTicks < 0) {
            // PCR は約 26.5 時間周期でラップアラウンドする
            deltaTicks += TsInfoAnalyzer.PCR_WRAP_TICKS;
        }

        const elapsedMs = (deltaTicks / TsInfoAnalyzer.PCR_TICK_HZ) * 1000;

        // 通常 TDT/TOT は数秒以内に見つかる。あり得ない補正量は壊れたストリーム等による
        // 誤検出とみなし、無補正のままにする
        if (Number.isFinite(elapsedMs) === false || elapsedMs < 0 || elapsedMs > TsInfoAnalyzer.MAX_PCR_CORRECTION_MS) {
            return null;
        }

        return tdtAt - elapsedMs;
    }

    /**
     * PCR サンプルから平均バイトレート (byte / ミリ秒) を実測する。
     * 中央から解析したときに「ファイル先頭からその位置までの経過時間」を見積もるために使う
     * @param pcrPid: number 対象サービスの PCR_PID
     * @param pcrSamples: PcrSample[] 収集した PCR サンプル (PID 混在)
     * @return number | null 測れない場合は null
     */
    private static calcBytesPerMs(pcrPid: number, pcrSamples: PcrSample[]): number | null {
        const pidSamples = pcrSamples.filter(s => s.pid === pcrPid);
        if (pidSamples.length < 2) {
            return null;
        }

        // PCR が不連続になった前後は同じ時間軸に無いため、epoch ごとに区切り、
        // その中で最も長い区間を使ってバイトレートを測る
        const epochs = new Map<number, { first: PcrSample; last: PcrSample }>();
        for (const s of pidSamples) {
            const range = epochs.get(s.epoch);
            if (typeof range === 'undefined') {
                epochs.set(s.epoch, { first: s, last: s });
                continue;
            }
            if (s.packetIndex < range.first.packetIndex) {
                range.first = s;
            }
            if (s.packetIndex > range.last.packetIndex) {
                range.last = s;
            }
        }

        let widest: { first: PcrSample; last: PcrSample } | null = null;
        for (const range of epochs.values()) {
            if (
                widest === null ||
                range.last.packetIndex - range.first.packetIndex > widest.last.packetIndex - widest.first.packetIndex
            ) {
                widest = range;
            }
        }
        if (widest === null) {
            return null;
        }
        const first = widest.first;
        const last = widest.last;

        let deltaTicks = last.pcr - first.pcr;
        if (deltaTicks < 0) {
            deltaTicks += TsInfoAnalyzer.PCR_WRAP_TICKS;
        }
        const elapsedMs = (deltaTicks / TsInfoAnalyzer.PCR_TICK_HZ) * 1000;
        if (Number.isFinite(elapsedMs) === false || elapsedMs < TsInfoAnalyzer.MIN_BITRATE_SPAN_MS) {
            return null;
        }

        const bytes = (last.packetIndex - first.packetIndex) * TsInfoAnalyzer.TS_PACKET_SIZE;

        return bytes <= 0 ? null : bytes / elapsedMs;
    }

    /**
     * ファイル先頭に対応する放送時刻を求める。
     *
     * 中央から解析した場合、そこで得た TDT/TOT はファイル先頭ではなく中央の時刻なので、
     * ①ファイル先頭を読み直して直接 TDT/TOT を得る ②中央の時刻から実測バイトレート分を
     * 遡って見積もる、の 2 通りで求める。
     * ①が取れたら常にそちらを採り、②は①が取れなかったときの代替としてのみ使う
     * (②はファイル全体が一定ビットレートである前提のため、再エンコード済みの VBR では大きく外れる)
     * @param filePath: string
     * @param startPosition: number 中央解析の読み出し開始位置 (バイト)
     * @param result: ScanResult 中央解析の結果
     * @param timeoutMs: number
     * @return Promise<number | null> どちらも求まらない場合は null
     */
    private async resolveFileStartAt(
        filePath: string,
        startPosition: number,
        result: ScanResult,
        timeoutMs: number,
    ): Promise<number | null> {
        const headAt = await this.scanHeadTime(filePath, result.pcrPid, timeoutMs);
        const estimated =
            result.regionStartAt !== null && result.bytesPerMs !== null
                ? result.regionStartAt - startPosition / result.bytesPerMs
                : null;

        if (headAt !== null) {
            // 先頭で実際に読んだ TDT/TOT が最も直接的な値なので原則こちらを採る。
            // 中央からの見積もりは「ファイル全体が一定ビットレート」を前提にしているため、
            // tsreplace 等で再エンコードした VBR のファイルでは数分単位で外れる
            // (実測: HEVC 出力で 7 分 48 秒ずれ、見積もりの方が誤りだった)。
            // よって見積もりは「先頭の値を採用するかどうか」の判断材料には使わない
            if (result.regionStartAt === null || headAt <= result.regionStartAt) {
                return Math.round(headAt);
            }

            // 先頭の時刻が中央の時刻より後になるのは時系列としてあり得ないため、
            // 壊れた TDT/TOT を読んだものとみなして見積もりへ退避する
            this.log.system.warn(
                `ts info head time is newer than region time: ${filePath} (head: ${new Date(headAt).toISOString()}, region: ${new Date(result.regionStartAt).toISOString()})`,
            );
        }

        return estimated === null ? null : Math.round(estimated);
    }

    /**
     * ファイル先頭から TDT/TOT を 1 つ読み、PCR でファイル先頭の時刻へ補正して返す。
     * TDT は 5 秒以下の周期で流れるため、最初の 1 つが見つかった時点で読み込みを打ち切る
     * @param filePath: string
     * @param pcrPid: number | null 対象サービスの PCR_PID (不明なら最初に見つかった PCR の PID を使う)
     * @param timeoutMs: number
     * @return Promise<number | null> 読めなかった場合は null
     */
    private scanHeadTime(filePath: string, pcrPid: number | null, timeoutMs: number): Promise<number | null> {
        return new Promise<number | null>(resolve => {
            let isFinished = false;
            let packetIndex = 0;
            const pcrSamples: PcrSample[] = [];
            // PID ごとの PCR 時間軸の世代 (discontinuity_indicator で切り替わる)
            const pcrEpochs = new Map<number, number>();
            let tdtAt: number | null = null;
            let tdtPacketIndex: number | null = null;

            const readableStream = fs.createReadStream(filePath, {
                start: 0,
                end: TsInfoAnalyzer.HEAD_PROBE_MAX_BYTES - 1,
            });
            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser();
            const tsSectionParser = new aribts.TsSectionParser();

            const finish = (): void => {
                if (isFinished === true) {
                    return;
                }
                isFinished = true;
                clearTimeout(timer);
                readableStream.unpipe();
                readableStream.destroy();

                if (tdtAt === null || tdtPacketIndex === null) {
                    resolve(null);

                    return;
                }

                const targetPid =
                    pcrPid !== null && pcrPid !== TsInfoAnalyzer.PCR_PID_NONE ? pcrPid : (pcrSamples[0]?.pid ?? null);
                if (targetPid === null) {
                    resolve(tdtAt);

                    return;
                }

                resolve(TsInfoAnalyzer.correctStartAtByPcr(tdtAt, tdtPacketIndex, targetPid, pcrSamples) ?? tdtAt);
            };

            const timer = setTimeout(() => {
                this.log.system.warn(`ts info head time analyze timeout: ${filePath}`);
                finish();
            }, timeoutMs);

            const onTimeTable = (jstTime: unknown): void => {
                if (tdtAt !== null) {
                    return;
                }
                const decoded = TsInfoAnalyzer.decodeJstDate(jstTime);
                if (decoded === null) {
                    return;
                }
                tdtAt = decoded;
                tdtPacketIndex = packetIndex;

                // ファイル先頭の時刻はこの 1 つで足りる
                finish();
            };

            tsSectionParser.on('tdt', (section: aribts.TsSectionTimeAndDate) => {
                try {
                    onTimeTable(section.decode().JST_time);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            tsSectionParser.on('tot', (section: aribts.TsSectionTimeOffset) => {
                try {
                    onTimeTable(section.decode().JST_time);
                } catch (err: any) {
                    // 壊れたセクションは無視して読み進める
                }
            });

            tsPacketParser.on('data', (packet: aribts.TsPacket) => {
                const currentIndex = packetIndex++;

                if (pcrSamples.length >= TsInfoAnalyzer.MAX_PCR_SAMPLES) {
                    return;
                }

                try {
                    if (packet.getPcrFlag() !== 1) {
                        return;
                    }

                    const decoded = packet.decode();
                    const af = decoded.adaptation_field;
                    if (
                        typeof af === 'undefined' ||
                        af === null ||
                        typeof af.program_clock_reference_base !== 'number' ||
                        typeof af.program_clock_reference_extension !== 'number'
                    ) {
                        return;
                    }

                    const pid = packet.getPid();
                    // 別の時間軸になった PCR を同じ軸として引き算しないよう epoch を進める
                    if (af.discontinuity_indicator === 1) {
                        pcrEpochs.set(pid, (pcrEpochs.get(pid) ?? 0) + 1);
                    }

                    pcrSamples.push({
                        pid: pid,
                        pcr: af.program_clock_reference_base * 300 + af.program_clock_reference_extension,
                        packetIndex: currentIndex,
                        epoch: pcrEpochs.get(pid) ?? 0,
                    });
                } catch (err: any) {
                    // 壊れたパケットは無視して読み進める
                }
            });

            readableStream.pipe(tsReadableConnector as unknown as stream.Writable);
            tsReadableConnector.pipe(tsPacketParser as any);
            tsPacketParser.pipe(tsSectionParser);

            readableStream.on('error', () => {
                finish();
            });
            readableStream.on('end', () => {
                finish();
            });
            readableStream.on('close', () => {
                finish();
            });
        });
    }

    /**
     * ISO 639-2 の言語コード (3 byte) を小文字の文字列にする
     * @return string | null 読めない場合は null
     */
    private static decodeLanguageCode(buffer: unknown): string | null {
        if (Buffer.isBuffer(buffer) === false || (buffer as Buffer).length < 3) {
            return null;
        }

        const code = (buffer as Buffer).toString('ascii', 0, 3).toLowerCase();

        return /^[a-z]{3}$/.test(code) === true ? code : null;
    }

    /**
     * ARIB 8 単位符号の文字列をデコードする
     */
    private static decodeChar(buffer: unknown): string | null {
        if (Buffer.isBuffer(buffer) === false || (buffer as Buffer).length === 0) {
            return null;
        }

        try {
            const text = new aribts.TsChar(buffer as Buffer).decode();

            return text.length === 0 ? null : text;
        } catch (err: any) {
            return null;
        }
    }

    /**
     * MJD + BCD (5 byte) の日時を UNIX 時刻 (ミリ秒) にする
     * TS 上の時刻は日本標準時なので、サーバのタイムゾーンに関係なく JST として解釈する
     * @return number | null 未定義 (全ビット 1) の場合は null
     */
    private static decodeJstDate(buffer: unknown): number | null {
        if (Buffer.isBuffer(buffer) === false || (buffer as Buffer).length < 5) {
            return null;
        }

        const bytes = buffer as Buffer;
        // 放送時間未定は全ビット 1 で送られる
        if (bytes[0] === 0xff && bytes[1] === 0xff) {
            return null;
        }

        try {
            const tsDate = new aribts.TsDate(bytes);
            const [year, month, day] = tsDate.decodeDate();
            const [hour, minute, second] = tsDate.decodeTime();

            return Date.UTC(year, month - 1, day, hour, minute, second) - TsInfoAnalyzer.JST_OFFSET_MS;
        } catch (err: any) {
            return null;
        }
    }

    /**
     * BCD (3 byte, HHMMSS) の継続時間を秒にする
     * @return number | null 未定義 (全ビット 1) の場合は null
     */
    private static decodeBcdDuration(buffer: unknown): number | null {
        if (Buffer.isBuffer(buffer) === false || (buffer as Buffer).length < 3) {
            return null;
        }

        const bytes = buffer as Buffer;
        // 放送時間未定
        if (bytes[0] === 0xff && bytes[1] === 0xff && bytes[2] === 0xff) {
            return null;
        }

        const hour = (bytes[0] >> 4) * 10 + (bytes[0] & 0x0f);
        const minute = (bytes[1] >> 4) * 10 + (bytes[1] & 0x0f);
        const second = (bytes[2] >> 4) * 10 + (bytes[2] & 0x0f);

        return hour * 3600 + minute * 60 + second;
    }

    private static createEmptyInfo(): TsInfo {
        return {
            networkId: null,
            transportStreamId: null,
            serviceId: null,
            serviceType: null,
            serviceName: null,
            serviceProviderName: null,
            networkName: null,
            eventId: null,
            eventName: null,
            eventDescription: null,
            eventExtended: null,
            eventStartAt: null,
            eventDuration: null,
            genres: [],
            videoType: null,
            videoResolution: null,
            videoStreamContent: null,
            videoComponentType: null,
            audioSamplingRate: null,
            audioComponentType: null,
            videoStreamType: null,
            videoPid: null,
            audioStreamType: null,
            audioPid: null,
            firstTdtAt: null,
            bitSections: [],
        };
    }
}
