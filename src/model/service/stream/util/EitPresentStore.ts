import { EventEmitter } from 'events';
import { injectable } from 'inversify';
import { EitOnAirRecord } from '../../../api/schedule/EitOnAirResolver';
import IEitPresentStore from './IEitPresentStore';

interface ChannelRecord {
    present: EitOnAirRecord | null;
    following: EitOnAirRecord | null;
}

@injectable()
export default class EitPresentStore implements IEitPresentStore {
    private records = new Map<number, ChannelRecord>();
    private emitter = new EventEmitter();

    /**
     * 読み取った EIT[p/f] を保存する
     * present と following は別々に保持する (混ぜると present が上書きされて消える)
     * @param channelId: number
     * @param event: EitOnAirRecord
     * @return boolean 直前の値から変化した場合 true
     */
    public update(channelId: number, event: EitOnAirRecord): boolean {
        const record: ChannelRecord = this.records.get(channelId) ?? { present: null, following: null };
        const previous = event.isFollowing === true ? record.following : record.present;
        const changed =
            previous === null ||
            previous?.eventId !== event.eventId ||
            previous?.startAt !== event.startAt ||
            previous?.durationSec !== event.durationSec ||
            previous?.runningStatus !== event.runningStatus;

        if (event.isFollowing === true) {
            record.following = event;
        } else {
            record.present = event;
        }
        this.records.set(channelId, record);

        if (changed === true) {
            this.emitter.emit('change', channelId, event);
        }

        return changed;
    }

    /**
     * 現在番組 (present) を返す
     * @param channelId: number
     * @return EitOnAirRecord | null
     */
    public get(channelId: number): EitOnAirRecord | null {
        return this.records.get(channelId)?.present ?? null;
    }

    /**
     * 次番組 (following) を返す
     * @param channelId: number
     * @return EitOnAirRecord | null
     */
    public getFollowing(channelId: number): EitOnAirRecord | null {
        return this.records.get(channelId)?.following ?? null;
    }

    /**
     * 保持している内容を破棄する (配信終了時)
     * @param channelId: number
     */
    public clear(channelId: number): void {
        this.records.delete(channelId);
    }

    /**
     * present が変わったときに呼ばれるリスナを登録する
     * @param listener: (channelId: number) => void
     */
    public onChange(listener: (channelId: number, event: EitOnAirRecord) => void): void {
        this.emitter.on('change', listener);
    }
}
