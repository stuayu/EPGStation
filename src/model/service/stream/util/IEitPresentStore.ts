import { EitOnAirRecord } from '../../../api/schedule/EitOnAirResolver';

export default interface IEitPresentStore {
    update(channelId: number, event: EitOnAirRecord): boolean;
    get(channelId: number): EitOnAirRecord | null;
    clear(channelId: number): void;
    onChange(listener: (channelId: number) => void): void;
}
