import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateEvent from './IEPGUpdateEvent';
import { ProgramUpdateNotice } from '../epgUpdater/ProgramUpdateNotice';

@injectable()
class EPGUpdateEvent implements IEPGUpdateEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * EPG 更新完了イベント発行
     */
    public emitUpdated(): void {
        this.emitter.emit(EPGUpdateEvent.UPDATED_EVENT);
    }

    /**
     * EIT[p/f] 相当の更新イベント発行 (視聴画面・番組表の即時更新に使う)
     * @param channelIds: number[]
     */
    public emitOnAirProgramUpdated(channelIds: number[]): void {
        this.emitter.emit(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED_EVENT, channelIds);
    }

    /**
     * EIT[p/f] 相当の更新イベント登録
     * @param callback: (channelIds: number[]) => void
     */
    public setOnAirProgramUpdated(callback: (channelIds: number[]) => void): void {
        this.emitter.on(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED_EVENT, (channelIds: number[]) => {
            try {
                callback(channelIds);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * 番組情報の更新通知イベント発行 (番組表の即時更新と予約の追従に使う)
     * @param notice: ProgramUpdateNotice
     */
    public emitProgramUpdated(notice: ProgramUpdateNotice): void {
        this.emitter.emit(EPGUpdateEvent.PROGRAM_UPDATED_EVENT, notice);
    }

    /**
     * 番組情報の更新通知イベント登録
     * @param callback: (notice: ProgramUpdateNotice) => void
     */
    public setProgramUpdated(callback: (notice: ProgramUpdateNotice) => void): void {
        this.emitter.on(EPGUpdateEvent.PROGRAM_UPDATED_EVENT, (notice: ProgramUpdateNotice) => {
            try {
                callback(notice);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * EPG 更新完了イベント登録
     * @param callback: () => void
     */
    public setUpdated(callback: () => void): void {
        this.emitter.on(EPGUpdateEvent.UPDATED_EVENT, async () => {
            try {
                await callback();
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * EPG 更新完了イベント登録 (一度だけ実行)
     * @param callback: () => void
     */
    public setUpdatedOnce(callback: () => void): void {
        this.emitter.once(EPGUpdateEvent.UPDATED_EVENT, async () => {
            try {
                await callback();
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace EPGUpdateEvent {
    export const UPDATED_EVENT = 'updated';
    export const ON_AIR_PROGRAM_UPDATED_EVENT = 'onAirProgramUpdated';
    export const PROGRAM_UPDATED_EVENT = 'programUpdated';
}

export default EPGUpdateEvent;
