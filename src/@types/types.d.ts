/**
 * 超手抜き aribts 定義
 */
declare module 'aribts' {
    import { EventEmitter } from 'eventemitter3';
    import * as stream from 'stream';

    export interface Result {
        [pid: number]: ResultItem;
    }

    export interface ResultItem {
        packet: number;
        error: number;
        drop: number;
        scrambling: number;
    }

    export class TsSectionProgramMap {
        public decode(): ProgramMap;
    }

    export interface ProgramMap {
        program_number: number;
        PCR_PID: number;
        program_info_length: number;
        program_info: unknown;
        streams: Stream[];
    }

    export interface Stream {
        stream_type: number;
        elementary_PID: number;
        ES_info_length: number;
        ES_info: unknown;
    }

    /**
     * 記述子 (descriptor)
     * decode() の戻りは記述子ごとに形が違うため、共通の descriptor_tag だけ型を付けている
     */
    export interface Descriptor {
        descriptor_tag: number;
        descriptor_length: number;
        [key: string]: any;
    }

    export class TsDescriptorBase {
        public decode(): Descriptor;
    }

    export class TsDescriptors {
        constructor(buffer: Buffer);
        public decode(): TsDescriptorBase[];
    }

    /**
     * CRC32 (セクションの誤り検出)
     */
    export class TsCrc32 {
        public static calc(buffer: Buffer): number;
        public static calcToBuffer(buffer: Buffer): Buffer;
    }

    /**
     * PAT (Program Association Table)
     */
    export interface ProgramAssociation {
        table_id: number;
        transport_stream_id: number;
        programs: Array<{
            program_number: number;
            network_PID?: number;
            program_map_PID?: number;
        }>;
    }

    export class TsSectionProgramAssociation {
        public decode(): ProgramAssociation;
    }

    /**
     * SDT (Service Description Table)
     */
    export interface ServiceDescription {
        table_id: number;
        transport_stream_id: number;
        original_network_id: number;
        services: Array<{
            service_id: number;
            running_status: number;
            descriptors: TsDescriptors;
        }>;
    }

    export class TsSectionServiceDescription {
        public decode(): ServiceDescription;
    }

    /**
     * NIT (Network Information Table)
     */
    export interface NetworkInformation {
        table_id: number;
        network_id: number;
        descriptors: TsDescriptors;
        transport_streams: Array<{
            transport_stream_id: number;
            original_network_id: number;
            descriptors: TsDescriptors;
        }>;
    }

    export class TsSectionNetworkInformation {
        public decode(): NetworkInformation;
    }

    /**
     * EIT (Event Information Table)
     */
    export interface EventInformation {
        table_id: number;
        service_id: number;
        transport_stream_id: number;
        original_network_id: number;
        section_number: number;
        last_section_number: number;
        events: Array<{
            event_id: number;
            start_time: Buffer;
            duration: Buffer;
            running_status: number;
            descriptors: TsDescriptors;
        }>;
    }

    export class TsSectionEventInformation {
        public decode(): EventInformation;
    }

    /**
     * TDT (Time and Date Table)
     */
    export interface TimeAndDate {
        table_id: number;
        JST_time: Buffer;
    }

    export class TsSectionTimeAndDate {
        public decode(): TimeAndDate;
    }

    /**
     * TOT (Time Offset Table)
     */
    export interface TimeOffset {
        table_id: number;
        JST_time: Buffer;
        descriptors: TsDescriptors;
    }

    export class TsSectionTimeOffset {
        public decode(): TimeOffset;
    }

    /**
     * ARIB 文字符号のデコーダ
     */
    export class TsChar {
        constructor(buffer: Buffer);
        public decode(): string;
    }

    /**
     * MJD + BCD 形式の日時デコーダ
     */
    export class TsDate {
        constructor(buffer: Buffer);
        public decode(): Date;
        public decodeDate(): [number, number, number];
        public decodeTime(): [number, number, number];
        public decodeTimeInSeconds(): number;
    }

    /**
     * TS パケット (188 byte) 1 つ分。adaptation_field は PCR (Program Clock Reference) の
     * 取得にのみ使っており、他フィールドはここでは型を付けていない
     */
    export interface AdaptationField {
        PCR_flag: number;
        program_clock_reference_base?: number;
        program_clock_reference_extension?: number;
        [key: string]: unknown;
    }

    export interface DecodedPacket {
        header: { PID: number; [key: string]: unknown };
        adaptation_field?: AdaptationField;
        [key: string]: unknown;
    }

    export class TsPacket {
        constructor(buffer: Buffer);
        public decode(): DecodedPacket;
        public getPid(): number;
        // adaptation_field が無い場合は -1
        public getPcrFlag(): number;
    }

    export class TsBase extends EventEmitter {
        public pipe: (pipe: TsBase) => boolean;
    }
    export class TsReadableConnector extends stream.Writable {}
    export class TsPacketParser extends TsBase {}
    export class TsPacketAnalyzer extends TsBase {
        public getResult(): Result;
    }
    export class TsSectionParser extends TsBase {}
    export class TsSectionAnalyzer extends TsBase {}
    export class TsSectionUpdater extends TsBase {}
    export interface PacketSelectorOption {
        pids: number[];
        programNumbers: number[];
    }

    export class TsPacketSelector extends TsBase {
        constructor(option: PacketSelectorOption);
        public onPmt(tsSection: TsSectionProgramMap): void;
    }
}
