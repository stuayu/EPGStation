import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import DateUtil from '@/util/DateUtil';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import { ChannelGroupingType, ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import IGuideReserveUtil, { ReserveStateItemIndex } from '../guide/IGuideReserveUtil';
import IOnAirState, { OnAirDisplayData, OnAirTabItem } from './IOnAirState';

@injectable()
export default class OnAirState implements IOnAirState {
    // タブ識別子の接頭辞 (地域タブ・系列タブと放送波種別タブを区別する)
    private static readonly REGION_TAB_PREFIX = 'region:';
    private static readonly AFFILIATION_TAB_PREFIX = 'affiliation:';
    private static readonly TYPE_TAB_PREFIX = 'type:';

    public selectedTab: string | undefined;

    private scheduleApiModel: IScheduleApiModel;
    private reserveUtil: IGuideReserveUtil;
    private settingStorage: ISettingStorageModel;
    private schedules: OnAirDisplayData[] = [];
    private reserveIndex: ReserveStateItemIndex = {};
    private tabs: apid.ChannelType[] = [];

    constructor(
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IGuideReserveUtil') reserveUtil: IGuideReserveUtil,
        @inject('ISettingStorageModel') settingStorage: ISettingStorageModel,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.reserveUtil = reserveUtil;
        this.settingStorage = settingStorage;

        // tab 設定
        const config = serverConfigModel.getConfig();
        if (config !== null) {
            if (config.broadcast.GR === true) {
                this.tabs.push('GR');
            }
            if (config.broadcast.BS === true) {
                this.tabs.push('BS');
            }
            if (config.broadcast.CS === true) {
                this.tabs.push('CS');
            }
            if (config.broadcast.SKY === true) {
                this.tabs.push('SKY');
            }
            if (config.broadcast.NW1 === true) {
                this.tabs.push('NW1');
            }
            if (config.broadcast.NW2 === true) {
                this.tabs.push('NW2');
            }
            if (config.broadcast.NW3 === true) {
                this.tabs.push('NW3');
            }
            if (config.broadcast.NW4 === true) {
                this.tabs.push('NW4');
            }
            if (config.broadcast.NW5 === true) {
                this.tabs.push('NW5');
            }
            if (config.broadcast.NW6 === true) {
                this.tabs.push('NW6');
            }
            if (config.broadcast.NW7 === true) {
                this.tabs.push('NW7');
            }
            if (config.broadcast.NW8 === true) {
                this.tabs.push('NW8');
            }
            if (config.broadcast.NW9 === true) {
                this.tabs.push('NW9');
            }
            if (config.broadcast.NW10 === true) {
                this.tabs.push('NW10');
            }
            if (config.broadcast.NW11 === true) {
                this.tabs.push('NW11');
            }
            if (config.broadcast.NW12 === true) {
                this.tabs.push('NW12');
            }
            if (config.broadcast.NW13 === true) {
                this.tabs.push('NW13');
            }
            if (config.broadcast.NW14 === true) {
                this.tabs.push('NW14');
            }
            if (config.broadcast.NW15 === true) {
                this.tabs.push('NW15');
            }
            if (config.broadcast.NW16 === true) {
                this.tabs.push('NW16');
            }
            if (config.broadcast.NW17 === true) {
                this.tabs.push('NW17');
            }
            if (config.broadcast.NW18 === true) {
                this.tabs.push('NW18');
            }
            if (config.broadcast.NW19 === true) {
                this.tabs.push('NW19');
            }
            if (config.broadcast.NW20 === true) {
                this.tabs.push('NW20');
            }
            if (config.broadcast.NW21 === true) {
                this.tabs.push('NW21');
            }
            if (config.broadcast.NW22 === true) {
                this.tabs.push('NW22');
            }
            if (config.broadcast.NW23 === true) {
                this.tabs.push('NW23');
            }
            if (config.broadcast.NW24 === true) {
                this.tabs.push('NW24');
            }
            if (config.broadcast.NW25 === true) {
                this.tabs.push('NW25');
            }
            if (config.broadcast.NW26 === true) {
                this.tabs.push('NW26');
            }
            if (config.broadcast.NW27 === true) {
                this.tabs.push('NW27');
            }
            if (config.broadcast.NW28 === true) {
                this.tabs.push('NW28');
            }
            if (config.broadcast.NW29 === true) {
                this.tabs.push('NW29');
            }
            if (config.broadcast.NW30 === true) {
                this.tabs.push('NW30');
            }
            if (config.broadcast.NW31 === true) {
                this.tabs.push('NW31');
            }
            if (config.broadcast.NW32 === true) {
                this.tabs.push('NW32');
            }
            if (config.broadcast.NW33 === true) {
                this.tabs.push('NW33');
            }
            if (config.broadcast.NW34 === true) {
                this.tabs.push('NW34');
            }
            if (config.broadcast.NW35 === true) {
                this.tabs.push('NW35');
            }
            if (config.broadcast.NW36 === true) {
                this.tabs.push('NW36');
            }
            if (config.broadcast.NW37 === true) {
                this.tabs.push('NW37');
            }
            if (config.broadcast.NW38 === true) {
                this.tabs.push('NW38');
            }
            if (config.broadcast.NW39 === true) {
                this.tabs.push('NW39');
            }
            if (config.broadcast.NW40 === true) {
                this.tabs.push('NW40');
            }
        }
    }

    /**
     * 取得した番組情報をクリア
     */
    public clearData(): void {
        this.schedules = [];
        this.reserveIndex = {};
    }

    /**
     * 番組情報を取得する
     * @param option: apid.BroadcastingScheduleOption
     */
    public async fetchData(option: apid.BroadcastingScheduleOption): Promise<void> {
        const now = new Date().getTime();
        this.reserveIndex = await this.reserveUtil.getReserveIndex({
            startAt: now,
            endAt: now + 3600 * 1000,
        });
        const datas = await this.scheduleApiModel.getScheduleOnAir(option);

        this.schedules = datas.map(d => {
            return this.createDisplayData(now, d);
        });
    }

    /**
     * apid.Schedule から OnAirDisplayData を生成する
     * @param baseTime: apid.UnixtimeMS
     * @param schedule: apid.Schedule
     * @return OnAirDisplayData
     */
    private createDisplayData(baseTime: apid.UnixtimeMS, schedule: apid.Schedule): OnAirDisplayData {
        const startAt = DateUtil.getJaDate(new Date(schedule.programs[0].startAt));
        const endAt = DateUtil.getJaDate(new Date(schedule.programs[0].endAt));

        const result: OnAirDisplayData = {
            display: {
                channelId: schedule.channel.id,
                channelName: schedule.channel.name,
                time: `${DateUtil.format(startAt, 'hh:mm')} ~ ${DateUtil.format(endAt, 'hh:mm')}`,
                name: schedule.programs[0].name,
                description: schedule.programs[0].description,
                extended: schedule.programs[0].extended,
                digestibility: this.getDigestibility(baseTime, schedule.programs[0].startAt, schedule.programs[0].endAt),
            },
            schedule: schedule,
        };

        if (schedule.channel.hasLogoData === true) {
            result.display.logoSrc = `./api/channels/${schedule.channel.id.toString(10)}/logo`;
        }

        return result;
    }

    /**
     * 番組終了までの割合を返す 0 ~ 100
     * @param baseTime: apid.UnixtimeMS
     * @param startAt: apid.UnixtimeMS
     * @param endAt: apid.UnixtimeMS
     * @return number
     */
    private getDigestibility(baseTime: apid.UnixtimeMS, startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): number {
        if (baseTime <= startAt) {
            return 0;
        }

        return ((baseTime - startAt) / (endAt - startAt)) * 100;
    }

    /**
     * digestibility を更新する
     */
    public updateDigestibility(): void {
        const now = new Date().getTime();

        for (const s of this.schedules) {
            s.display.digestibility = s.schedule.programs.length === 0 ? 0 : this.getDigestibility(now, s.schedule.programs[0].startAt, s.schedule.programs[0].endAt);
        }
    }

    /**
     * 取得した番組情報を返す
     * @return OnAirDisplayData[]
     */
    public getSchedules(tabId?: string): OnAirDisplayData[] {
        if (typeof tabId === 'undefined') {
            return this.schedules;
        }

        // 地域タブは地上波系 (GR / NWxx) をまとめて表示する
        if (tabId.startsWith(OnAirState.REGION_TAB_PREFIX) === true) {
            const regionId = tabId.slice(OnAirState.REGION_TAB_PREFIX.length);

            return this.schedules.filter(s => {
                return (
                    OnAirState.isRegionalType(s.schedule.channel.channelType) === true &&
                    OnAirState.getRegionId(s.schedule.channel) === regionId
                );
            });
        }

        // 系列タブも同様に地上波系をまとめて表示する
        if (tabId.startsWith(OnAirState.AFFILIATION_TAB_PREFIX) === true) {
            const affiliationId = tabId.slice(OnAirState.AFFILIATION_TAB_PREFIX.length);

            return this.schedules.filter(s => {
                return (
                    OnAirState.isRegionalType(s.schedule.channel.channelType) === true &&
                    OnAirState.getAffiliationId(s.schedule.channel) === affiliationId
                );
            });
        }

        const type = tabId.startsWith(OnAirState.TYPE_TAB_PREFIX) === true ? tabId.slice(OnAirState.TYPE_TAB_PREFIX.length) : tabId;

        return this.schedules.filter(s => {
            return s.schedule.channel.channelType === type;
        });
    }

    /**
     * 予約情報の索引を返す
     * @return ReserveStateItemIndex
     */
    public getReserveIndex(): ReserveStateItemIndex {
        return this.reserveIndex;
    }

    /**
     * タブの一覧を返す。
     * 地上波系 (GR / NWxx) は番組表と同じ地域名でまとめ、BS / CS / SKY は放送波種別で分ける
     * @return OnAirTabItem[]
     */
    public getTabs(): OnAirTabItem[] {
        const regionalTypes = this.tabs.filter(type => OnAirState.isRegionalType(type) === true);
        const otherTypes = this.tabs.filter(type => OnAirState.isRegionalType(type) === false);

        const result: OnAirTabItem[] = [];
        const isAffiliationMode = this.getGroupingType() === 'affiliation';
        const groups = regionalTypes.length === 0 ? [] : this.getChannelGroups(regionalTypes, isAffiliationMode);
        if (groups.length === 0) {
            // 番組情報が未取得などでグループを判定できない場合は放送波種別で表示する
            for (const type of regionalTypes) {
                result.push({ id: `${OnAirState.TYPE_TAB_PREFIX}${type}`, name: type });
            }
        } else {
            const prefix = isAffiliationMode ? OnAirState.AFFILIATION_TAB_PREFIX : OnAirState.REGION_TAB_PREFIX;
            for (const group of groups) {
                result.push({ id: `${prefix}${group.id}`, name: group.name });
            }
        }

        for (const type of otherTypes) {
            result.push({ id: `${OnAirState.TYPE_TAB_PREFIX}${type}`, name: type });
        }

        return result;
    }

    /**
     * 地上波系 (GR / NWxx) の放送波種別か
     * @param type: string
     * @return boolean
     */
    private static isRegionalType(type: string): boolean {
        return type === 'GR' || /^NW\d+$/.test(type) === true;
    }

    /**
     * 放送局の地域 id を返す (地域不明の場合は 'other')
     * @param channel: apid.ScheduleChannleItem
     * @return string
     */
    private static getRegionId(channel: apid.ScheduleChannleItem): string {
        return typeof channel.region === 'undefined' ? 'other' : channel.region.id;
    }

    /**
     * 放送局の系列 id を返す (BIT 未受信の場合は 'unknown')
     * @param channel: apid.ScheduleChannleItem
     * @return string
     */
    private static getAffiliationId(channel: apid.ScheduleChannleItem): string {
        return typeof channel.affiliation === 'undefined' ? 'unknown' : channel.affiliation.id;
    }

    /**
     * 地上波系をまとめる軸 (地域別 / 系列別) を返す
     * @return ChannelGroupingType
     */
    private getGroupingType(): ChannelGroupingType {
        return this.settingStorage.getSavedValue().channelGroupingType ?? 'region';
    }

    /**
     * 取得済みの番組情報からグループ (地域 or 系列) の一覧を作成する
     * 判定不能な放送局 (CATV 等 / BIT 未受信) は末尾にまとめられる
     * @param regionalTypes: apid.ChannelType[] 対象の放送波種別
     * @param isAffiliationMode: boolean 系列別にまとめるか
     * @return apid.BroadcastRegionItem[]
     */
    private getChannelGroups(
        regionalTypes: apid.ChannelType[],
        isAffiliationMode: boolean,
    ): apid.BroadcastRegionItem[] {
        const groups: apid.BroadcastRegionItem[] = [];
        const addedIds: { [groupId: string]: boolean } = {};

        for (const s of this.schedules) {
            const channel = s.schedule.channel;
            if (regionalTypes.indexOf(channel.channelType) === -1) {
                continue;
            }

            const group = isAffiliationMode ? channel.affiliation : channel.region;
            if (typeof group === 'undefined') {
                continue;
            }

            if (addedIds[group.id] === true) {
                continue;
            }
            addedIds[group.id] = true;
            groups.push({ id: group.id, name: group.name, order: group.order });
        }

        // 表示順に並べる (判定不能なものは order が大きいので必ず末尾になる)
        return groups.sort((a, b) => a.order - b.order);
    }

    /**
     * 次の更新までの待ち時間を返す (ms)
     * @return number
     */
    public getUpdateTime(): number {
        if (this.schedules.length === 0) {
            return 1000;
        }

        let min = 6048000000;
        const now = new Date().getTime();
        for (const s of this.schedules) {
            const endTime = s.schedule.programs[0].endAt - now;
            if (min > endTime) {
                min = endTime;
            }
        }
        if (min < 0) {
            min = 0;
        }

        return min;
    }
}
