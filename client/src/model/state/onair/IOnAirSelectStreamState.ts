import * as apid from '../../../../../api';
import type { StreamingTypeLabel } from '@/util/StreamingTypeUtil';

// オリジナル (MPEG-2・端末で変換) は config の配信設定に無く、playback-options が返したときだけ加える
export type LiveStreamType = StreamingTypeLabel | 'オリジナル';

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
    addOriginalStreamType(): void;
    getM2TSURL(): string | null;
    getM2TPlayListURL(): string | null;
}
