import * as apid from '../../../../../api';
import { ReserveStateItemIndex } from '../guide/IGuideReserveUtil';

export interface OnAirDisplayData {
    display: {
        channelId: apid.ChannelId;
        channelName: string;
        logoSrc?: string;
        time: string;
        name: string;
        description?: string;
        extended?: string;
        digestibility: number; // 0 ~ 100
    };
    schedule: apid.Schedule;
}

/**
 * 放映中一覧のタブ
 * 地上波系 (GR / NWxx) は番組表と同じ地域名でまとめ、BS / CS / SKY は放送波種別で分ける
 */
export interface OnAirTabItem {
    // タブの識別子 (地域は 'region:<地域 id>'、放送波種別は 'type:<ChannelType>')
    id: string;
    // タブに表示する名前
    name: string;
}

export default interface IOnAirState {
    selectedTab: string | undefined;
    clearData(): void;
    fetchData(option: apid.BroadcastingScheduleOption): Promise<void>;
    updateDigestibility(): void;
    getSchedules(tabId?: string): OnAirDisplayData[];
    getReserveIndex(): ReserveStateItemIndex;
    getTabs(): OnAirTabItem[];
    getUpdateTime(): number;
}
