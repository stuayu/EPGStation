import * as apid from '../../../../../api';
import type { StreamingTypeLabel } from '@/util/StreamingTypeUtil';

export type LiveStreamType = StreamingTypeLabel;

export interface StreamConfigItem {
    title: string;
    value: number;
}

export default interface IOnAirSelectStreamState {
    isOpen: boolean;
    useURLScheme: boolean;
    streamTypes: LiveStreamType[];
    streamConfigItems: StreamConfigItem[];
    selectedStreamType: LiveStreamType | undefined;
    selectedStreamConfig: number | undefined;
    open(channelItem: apid.ScheduleChannleItem): void;
    close(): void;
    getChannelItem(): apid.ScheduleChannleItem | null;
    updateStreamTypes(): void;
    updateStreamConfig(): void;
    getM2TSURL(): string | null;
    getM2TPlayListURL(): string | null;
}
