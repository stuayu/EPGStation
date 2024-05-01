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
    export const PROGRAM_UPDATED = 'program updated';
    export const SERVICE_UPDATED = 'service updated';
}

export default interface IEPGUpdateManageModel extends EventEmitter {
    updateAll(): Promise<void>;
    updateChannels(): Promise<void>;
    start(): Promise<void>;
    getProgramQueueSize(): number;
    getServiceQueueSize(): number;
    saveProgram(timeThreshold?: number): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    saveService(): Promise<void>;
}
