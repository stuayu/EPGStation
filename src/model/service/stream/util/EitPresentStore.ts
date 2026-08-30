import { injectable } from 'inversify';
import { EitOnAirRecord } from '../../../api/schedule/EitOnAirResolver';
import IEitPresentStore from './IEitPresentStore';
import { EventEmitter } from 'events';

@injectable()
export default class EitPresentStore implements IEitPresentStore {
    private records = new Map<number, EitOnAirRecord>();
    private emitter = new EventEmitter();

    public update(channelId: number, event: EitOnAirRecord): boolean {
        const previous = this.records.get(channelId);
        this.records.set(channelId, event);
        const changed = previous?.eventId !== event.eventId || previous?.isFollowing !== event.isFollowing;
        if (changed && event.isFollowing === false) this.emitter.emit('change', channelId);
        return changed;
    }

    public get(channelId: number): EitOnAirRecord | null {
        return this.records.get(channelId) ?? null;
    }

    public clear(channelId: number): void {
        this.records.delete(channelId);
    }

    public onChange(listener: (channelId: number) => void): void {
        this.emitter.on('change', listener);
    }
}
