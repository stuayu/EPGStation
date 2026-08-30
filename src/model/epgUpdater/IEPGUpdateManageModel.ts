import { EventEmitter } from 'events';
import * as mapid from '../../../node_modules/mirakurun/api';

export interface RemoveProgram {
    id: mapid.ProgramId;
}
export interface RedefineProgram {
    from: mapid.ProgramId;
    to: mapid.ProgramId;
}

export interface ProgramBaseEvent extends mapid.Event {
    resource: 'program';
    data: RedefineProgram | RemoveProgram | mapid.Program;
}

export interface CreateEvent extends ProgramBaseEvent {
    type: 'create';
    data: mapid.Program;
}

export interface UpdateEvent extends ProgramBaseEvent {
    type: 'update';
    data: mapid.Program;
}

export interface RemoveEvent extends ProgramBaseEvent {
    type: 'remove';
    data: RemoveProgram;
}

export interface RedefineEvent extends ProgramBaseEvent {
    type: 'remove';
    data: RedefineProgram;
}

export interface ServiceEvent extends mapid.Event {
    resource: 'service';
    data: mapid.Service;
}

export namespace EPGUpdateEvent {
    export const STREAM_STARTED = 'event stream started';
    export const STREAM_ABORTED = 'event stream aborted';
    export const STREAM_NO_EVENT = 'event stream disconnected without event';
    export const PROGRAM_UPDATED = 'program updated';
    // EIT[p/f] 相当 (現在放送中 / 直後に始まる番組) が更新された放送局の通知
    export const ON_AIR_PROGRAM_UPDATED = 'on air program updated';
    // 即時反映すべき番組更新イベントを受信した (災害時の特番割り込み・延長など)
    export const URGENT_ENQUEUED = 'urgent program event enqueued';
    // 番組情報が更新された放送局・時間帯・番組 id の通知 (番組表の即時更新と予約の追従に使う)
    export const PROGRAM_RANGE_UPDATED = 'program range updated';
    export const SERVICE_UPDATED = 'service updated';
}

/**
 * saveProgram のオプション
 */
export interface SaveProgramOption {
    // true の場合、即時反映が必要と判定されたイベントだけを DB へ反映し、残りはキューに残す
    // (この場合 timeThreshold による足切りは行わない)
    urgentOnly?: boolean;
}

/**
 * チューナーサーバの種別
 */
export enum TunerServerType {
    mirakurun,
    mirakc,
}

export default interface IEPGUpdateManageModel extends EventEmitter {
    updateAll(): Promise<void>;
    updateChannels(): Promise<void>;
    checkTunerServerType(): Promise<TunerServerType>;
    start(): Promise<void>;
    saveProgram(timeThreshold?: number, option?: SaveProgramOption): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    saveService(): Promise<void>;
    saveOnAirServices(): Promise<void>;
    saveUpdateServices(): Promise<void>;
    updateProgramsByChannels(channelIds: number[]): Promise<void>;
}
