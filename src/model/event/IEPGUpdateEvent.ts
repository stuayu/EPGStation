import { ProgramUpdateNotice } from '../epgUpdater/ProgramUpdateNotice';

export default interface IEPGUpdateEvent {
    emitUpdated(): void;
    /**
     * EIT[p/f] 相当 (現在放送中 / 直後に始まる番組) が更新された放送局の通知を発行する
     * @param channelIds: number[]
     */
    emitOnAirProgramUpdated(channelIds: number[]): void;
    /**
     * 上記の通知を受け取る
     * @param callback: (channelIds: number[]) => void
     */
    setOnAirProgramUpdated(callback: (channelIds: number[]) => void): void;
    /**
     * 番組情報が更新された放送局・時間帯・番組 id の通知を発行する
     * @param notice: ProgramUpdateNotice
     */
    emitProgramUpdated(notice: ProgramUpdateNotice): void;
    /**
     * 上記の通知を受け取る
     * @param callback: (notice: ProgramUpdateNotice) => void
     */
    setProgramUpdated(callback: (notice: ProgramUpdateNotice) => void): void;
    setUpdated(callback: () => void): void;
    setUpdatedOnce(callback: () => void): void;
}
