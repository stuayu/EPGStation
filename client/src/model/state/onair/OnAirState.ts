import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import DateUtil from '@/util/DateUtil';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import IGuideReserveUtil, { ReserveStateItemIndex } from '../guide/IGuideReserveUtil';
import IOnAirState, { OnAirDisplayData } from './IOnAirState';

@injectable()
export default class OnAirState implements IOnAirState {
    public selectedTab: apid.ChannelType | undefined;

    private scheduleApiModel: IScheduleApiModel;
    private reserveUtil: IGuideReserveUtil;
    private schedules: OnAirDisplayData[] = [];
    private reserveIndex: ReserveStateItemIndex = {};
    private tabs: apid.ChannelType[] = [];

    constructor(
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IGuideReserveUtil') reserveUtil: IGuideReserveUtil,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.reserveUtil = reserveUtil;

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
    public getSchedules(type?: apid.ChannelType): OnAirDisplayData[] {
        return typeof type === 'undefined'
            ? this.schedules
            : this.schedules.filter(s => {
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
     * 放送波名の配列を返す
     * @return string[]
     */
    public getTabs(): apid.ChannelType[] {
        return this.tabs;
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
