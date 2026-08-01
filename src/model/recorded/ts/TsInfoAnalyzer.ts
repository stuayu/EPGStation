import * as aribts from 'aribts';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as stream from 'stream';
import BitParser from '../../channel/BitParser';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ITsInfoAnalyzer, { TsGenre, TsInfo, TsInfoAnalyzeOption } from './ITsInfoAnalyzer';

/**
 * TS ファイルの PSI/SI (PAT / SDT / NIT / EIT / TDT / PMT) を解析して
 * 放送局・番組・ストリーム構成の情報を取り出す
 *
 * ファイル全体は読まず、必要なテーブルが揃うか上限に達した時点で打ち切る
 */
@injectable()
export default class TsInfoAnalyzer implements ITsInfoAnalyzer {
    // 解析のために読み込む既定の最大バイト数 (TDT / EIT[p/f] が一巡するには十分な量)
    private static readonly DEFAULT_MAX_READ_BYTES = 64 * 1024 * 1024;
    // 解析の既定の打ち切り時間
    private static readonly DEFAULT_TIMEOUT_MS = 60 * 1000;
    private static readonly JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
     * @param filePath: string 解析対象のファイルパス
     * @param option: TsInfoAnalyzeOption
     * @return Promise<TsInfo> 解析できなかった項目は null で返る
     */
    public analyze(filePath: string, option?: TsInfoAnalyzeOption): Promise<TsInfo> {
        const maxReadBytes = option?.maxReadBytes ?? TsInfoAnalyzer.DEFAULT_MAX_READ_BYTES;
        const timeoutMs = option?.timeoutMs ?? TsInfoAnalyzer.DEFAULT_TIMEOUT_MS;

        return new Promise<TsInfo>(resolve => {
            const info: TsInfo = TsInfoAnalyzer.createEmptyInfo();
            // SDT / EIT は全サービス分流れてくるため、対象サービスを決めるまでは候補として保持する
            const sdtServices = new Map<
                number,
                { serviceType: number | null; name: string | null; provider: string | null }
            >();
            const pmtStreams = new Map<number, aribts.Stream[]>();
            // program_number -> PCR_PID (TDT/TOT のファイル先頭時刻補正に使う)
            const pmtPcrPids = new Map<number, number>();
            let patServiceIds: number[] = [];
            let isFinished = false;

            // PCR による TDT/TOT 時刻の補正用: 受信したパケット数 (= ファイル先頭からの相対位置) と、
            // PID ごとの PCR サンプル (ファイル先頭からの経過時間を測るための基準点)
            let packetIndex = 0;
            const pcrSamples: Array<{ pid: number; pcr: number; packetIndex: number }> = [];
            // 最初に確定した TDT/TOT が見つかった時点でのパケット位置
            let firstTdtPacketIndex: number | null = null;

            const readableStream = fs.createReadStream(filePath, { start: 0, end: Math.max(0, maxReadBytes - 1) });
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

                // 対象サービスが決まっていない場合は PAT の先頭を採用する
                if (info.serviceId === null && patServiceIds.length > 0) {
                    info.serviceId = patServiceIds[0];
                }

                // 対象サービスの SDT 情報を反映する
                if (info.serviceId !== null) {
                    const service = sdtServices.get(info.serviceId);
                    if (typeof service !== 'undefined') {
                        info.serviceType = service.serviceType;
                        info.serviceName = service.name;
                        info.serviceProviderName = service.provider;
                    }

                    const streams = pmtStreams.get(info.serviceId);
                    if (typeof streams !== 'undefined') {
                        TsInfoAnalyzer.setStreamInfo(info, streams);
                    }

                    // TDT/TOT で得た時刻を、実際に見つかった位置 (ファイル先頭からの経過時間) の分だけ
                    // 遡って補正する。対象サービスの PCR_PID が分からない・PCR サンプルが
                    // 足りない等で補正できない場合は無補正の値のまま使う
                    if (info.firstTdtAt !== null && firstTdtPacketIndex !== null) {
                        const pcrPid = pmtPcrPids.get(info.serviceId);
                        if (typeof pcrPid === 'number' && pcrPid !== TsInfoAnalyzer.PCR_PID_NONE) {
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
                    }
                }

                readableStream.unpipe();
                readableStream.destroy();
                resolve(info);
            };

            // 必要な情報がそろっていれば残りは読まずに打ち切る
            const checkFinish = (): void => {
                if (TsInfoAnalyzer.hasEnoughInfo(info, sdtServices, pmtStreams)) {
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

            // EIT[p/f] present: 録画された番組そのものの情報
            tsSectionParser.on('eit', (section: aribts.TsSectionEventInformation) => {
                if (info.eventId !== null) {
                    return;
                }

                try {
                    const eit = section.decode();
                    // 自ストリームの present (section 0) のみ採用する
                    if (eit.table_id !== TsInfoAnalyzer.TABLE_ID_EIT_PF_ACTUAL || eit.section_number !== 0) {
                        return;
                    }
                    const event = eit.events[0];
                    if (typeof event === 'undefined') {
                        return;
                    }

                    // EIT[p/f] は同一 TS の全サービス分が流れてくる。
                    // PAT に載っているサービス (サービス指定で録画されたファイルでは対象サービスのみ) 以外は採用しない
                    if (patServiceIds.length > 0 && patServiceIds.includes(eit.service_id) === false) {
                        return;
                    }

                    // EIT[p/f] が流れているサービスを対象サービスとして確定させる
                    info.serviceId = eit.service_id;
                    info.networkId = eit.original_network_id;
                    info.transportStreamId = eit.transport_stream_id;

                    info.eventId = event.event_id;
                    info.eventStartAt = TsInfoAnalyzer.decodeJstDate(event.start_time);
                    info.eventDuration = TsInfoAnalyzer.decodeBcdDuration(event.duration);

                    TsInfoAnalyzer.setEventDescriptors(info, event.descriptors);
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

            // PCR (Program Clock Reference) サンプリング。
            // tsSectionParser とは別に生パケットを直接覗き見る (pipe の消費とは独立に動く追加の
            // 'data' リスナーとして安全に併存できる。ストリームの分岐・消費はしない)
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

                    pcrSamples.push({
                        pid: packet.getPid(),
                        pcr: af.program_clock_reference_base * 300 + af.program_clock_reference_extension,
                        packetIndex: currentIndex,
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
     * 局名・番組・時刻・ストリーム構成がそろっていればファイルの残りを読む必要はない
     */
    private static hasEnoughInfo(
        info: TsInfo,
        sdtServices: Map<number, unknown>,
        pmtStreams: Map<number, unknown>,
    ): boolean {
        return (
            info.serviceId !== null &&
            info.eventId !== null &&
            info.firstTdtAt !== null &&
            sdtServices.has(info.serviceId) &&
            pmtStreams.has(info.serviceId)
        );
    }

    /**
     * EIT の記述子から番組名・概要・詳細・ジャンルを取り出す
     */
    private static setEventDescriptors(info: TsInfo, descriptors: aribts.TsDescriptors): void {
        // extended_event_descriptor は複数に分割されるため、項目名ごとにつなぎ合わせる
        const extendedItems: Array<{ description: string; value: string }> = [];

        for (const descriptor of descriptors.decode()) {
            const d = descriptor.decode();
            switch (d.descriptor_tag) {
                case TsInfoAnalyzer.DESCRIPTOR_TAG_SHORT_EVENT:
                    info.eventName = TsInfoAnalyzer.decodeChar(d.event_name);
                    info.eventDescription = TsInfoAnalyzer.decodeChar(d.text);
                    break;
                case TsInfoAnalyzer.DESCRIPTOR_TAG_EXTENDED_EVENT:
                    for (const item of d.items ?? []) {
                        const description = TsInfoAnalyzer.decodeChar(item.item_description) ?? '';
                        const value = TsInfoAnalyzer.decodeChar(item.item) ?? '';
                        const last = extendedItems[extendedItems.length - 1];
                        // 項目名が空の場合は直前の項目の続き
                        if (description === '' && typeof last !== 'undefined') {
                            last.value += value;
                        } else {
                            extendedItems.push({ description: description, value: value });
                        }
                    }
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
                    // 映像は複数流れることがあるが、EPGStation が持つのは代表 1 本なので最初のものを採用する
                    if (info.videoComponentType === null) {
                        info.videoStreamContent = d.stream_content ?? null;
                        info.videoComponentType = d.component_type ?? null;
                        info.videoType = TsInfoAnalyzer.STREAM_CONTENT[d.stream_content] ?? null;
                        info.videoResolution = TsInfoAnalyzer.COMPONENT_TYPE_RESOLUTION[d.component_type] ?? null;
                    }
                    break;
                case TsInfoAnalyzer.DESCRIPTOR_TAG_AUDIO_COMPONENT:
                    if (info.audioComponentType === null) {
                        info.audioComponentType = d.component_type ?? null;
                        const samplingRate = TsInfoAnalyzer.SAMPLING_RATE[d.sampling_rate] ?? -1;
                        info.audioSamplingRate = samplingRate > 0 ? samplingRate : null;
                    }
                    break;
                default:
                    break;
            }
        }

        if (extendedItems.length > 0) {
            info.eventExtended = extendedItems.map(item => `${item.description}\n${item.value}`).join('\n\n');
        }
    }

    /**
     * PMT のストリーム一覧から映像・音声の代表 1 本ずつを拾う
     */
    private static setStreamInfo(info: TsInfo, streams: aribts.Stream[]): void {
        for (const s of streams) {
            if (info.videoPid === null && TsInfoAnalyzer.VIDEO_STREAM_TYPES.includes(s.stream_type)) {
                info.videoStreamType = s.stream_type;
                info.videoPid = s.elementary_PID;
            } else if (info.audioPid === null && TsInfoAnalyzer.AUDIO_STREAM_TYPES.includes(s.stream_type)) {
                info.audioStreamType = s.stream_type;
                info.audioPid = s.elementary_PID;
            }
        }
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
        pcrSamples: Array<{ pid: number; pcr: number; packetIndex: number }>,
    ): number | null {
        const samples = pcrSamples.filter(s => s.pid === pcrPid);
        if (samples.length < 2) {
            // 基準点 (ファイル先頭付近) と終点 (TDT/TOT 付近) の 2 点がそろわないと測れない
            return null;
        }

        // ファイル先頭に最も近い (最小 packetIndex) サンプルを起点とする
        let first = samples[0];
        for (const s of samples) {
            if (s.packetIndex < first.packetIndex) {
                first = s;
            }
        }

        // TDT/TOT が見つかった位置以前で、最も近いサンプルを終点とする
        let nearest: { pid: number; pcr: number; packetIndex: number } | null = null;
        for (const s of samples) {
            if (s.packetIndex <= tdtPacketIndex && (nearest === null || s.packetIndex > nearest.packetIndex)) {
                nearest = s;
            }
        }
        if (nearest === null || nearest.packetIndex === first.packetIndex) {
            // TDT/TOT より前に (起点と別の) PCR サンプルが無く、経過時間を測れない
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
     * ARIB 8 単位符号の Buffer を文字列にする
     * @return string | null デコードできない場合は null
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
