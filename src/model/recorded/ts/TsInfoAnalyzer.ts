import * as aribts from 'aribts';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as stream from 'stream';
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

    private static readonly TABLE_ID_NIT_ACTUAL = 0x40;
    private static readonly TABLE_ID_SDT_ACTUAL = 0x42;
    private static readonly TABLE_ID_EIT_PF_ACTUAL = 0x4e;

    private static readonly DESCRIPTOR_TAG_NETWORK_NAME = 0x40;
    private static readonly DESCRIPTOR_TAG_SERVICE = 0x48;
    private static readonly DESCRIPTOR_TAG_SHORT_EVENT = 0x4d;
    private static readonly DESCRIPTOR_TAG_EXTENDED_EVENT = 0x4e;
    private static readonly DESCRIPTOR_TAG_CONTENT = 0x54;

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
            let patServiceIds: number[] = [];
            let isFinished = false;

            const readableStream = fs.createReadStream(filePath, { start: 0, end: Math.max(0, maxReadBytes - 1) });
            const tsReadableConnector = new aribts.TsReadableConnector();
            const tsPacketParser = new aribts.TsPacketParser();
            const tsSectionParser = new aribts.TsSectionParser();

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

            // TDT / TOT: ファイル先頭付近の放送時刻 = 録画開始時刻
            // TOT は TDT と同じ PID (0x14) で流れ、日本の放送では両方送出される
            const onTimeTable = (jstTime: unknown): void => {
                if (info.firstTdtAt === null) {
                    info.firstTdtAt = TsInfoAnalyzer.decodeJstDate(jstTime);
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

            readableStream.pipe(tsReadableConnector as unknown as stream.Writable);
            tsReadableConnector.pipe(tsPacketParser as any);
            tsPacketParser.pipe(tsSectionParser);

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
            videoStreamType: null,
            videoPid: null,
            audioStreamType: null,
            audioPid: null,
            firstTdtAt: null,
        };
    }
}
