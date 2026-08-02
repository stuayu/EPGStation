import ChannelModel from '@/model/channels/ChannelModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { IGuideGenreSettingStorageModel, IGuideGenreSettingValue } from '@/model/storage/guide/IGuideGenreSettingStorageModel';
import { sortByKeyStationAndPrefecture } from '@/util/AffiliationChannelSort';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { normalizeSeriesTitleForGuide } from '@/util/SeriesTitleNormalizer';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import ISeriesApiModel from '../../api/series/ISeriesApiModel';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import IGuideProgramDialogState, { ProgramDialogOpenOption } from './IGuideProgramDialogState';
import IGuideReserveUtil, { ReserveStateItemIndex } from './IGuideReserveUtil';
import IGuideState, { DisplayRange, FetchGuideOption, ProgramDomItem } from './IGuideState';

interface CreateProgramDomOption {
    top: number;
    left: number;
    height: number;
    channel: apid.ScheduleChannleItem;
    program: apid.ScheduleProgramItem;
    isHidden: boolean;
}

@injectable()
class GuideState implements IGuideState {
    private scheduleApiModel: IScheduleApiModel;
    private settingModel: ISettingStorageModel;
    private programDialogState: IGuideProgramDialogState;
    private reserveUtil: IGuideReserveUtil;
    private genreSetting: IGuideGenreSettingStorageModel;
    private seriesApiModel: ISeriesApiModel;
    private serverConfigModel: IServerConfigModel;

    // 「追いかけ中」インジケータ (§4.10) 用。録画済みシリーズの正規化タイトル集合 (ベストエフォート判定・簡易実装)
    private followingTitleSet: Set<string> | null = null;

    private displayRange: DisplayRange | null = null;
    private startAt: apid.UnixtimeMS = 0;
    private regionName: string | null = null; // 地域別・系列別番組表のグループ表示名
    private endAt: apid.UnixtimeMS = 0;
    private programDoms: ProgramDomItem[] = [];
    // 番組情報を programId 索引するための変数
    private programDomIndex: { [programId: number]: HTMLElement[] } = {};

    private startTime: string | null = null;
    private timeLength: number = 0;
    private schedules: apid.Schedule[] = [];
    private reserveIndex: ReserveStateItemIndex = {};

    constructor(
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IGuideProgramDialogState') programDialogState: IGuideProgramDialogState,
        @inject('IGuideReserveUtil') reserveUtil: IGuideReserveUtil,
        @inject('IGuideGenreSettingStorageModel') genreSetting: IGuideGenreSettingStorageModel,
        @inject('ISeriesApiModel') seriesApiModel: ISeriesApiModel,
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
    ) {
        this.scheduleApiModel = scheduleApiModel;
        this.settingModel = settingModel;
        this.programDialogState = programDialogState;
        this.reserveUtil = reserveUtil;
        this.genreSetting = genreSetting;
        this.seriesApiModel = seriesApiModel;
        this.serverConfigModel = serverConfigModel;
    }

    /**
     * 「追いかけ中」インジケータの表示可否を判定する (機能フラグ + ユーザー設定)
     * @return boolean
     */
    private isFollowingIndicatorEnabled(): boolean {
        const config = this.serverConfigModel.getConfig();
        return (
            isFeatureEnabled(config, 'seriesLibrary') === true &&
            isFeatureEnabled(config, 'programSeriesMapping') === true &&
            this.settingModel.getSavedValue().isShowFollowingIndicatorInGuide === true
        );
    }

    /**
     * 追いかけ中判定用のシリーズタイトル集合を取得する (簡易実装のため取得失敗時は握りつぶす)
     */
    private async loadFollowingTitleSet(): Promise<void> {
        if (this.isFollowingIndicatorEnabled() === false) {
            this.followingTitleSet = null;
            return;
        }

        try {
            // GET /api/series の limit には上限があるため、上限件数までページングして集める
            const titles = new Set<string>();
            for (let offset = 0; offset < GuideState.FOLLOWING_TITLE_FETCH_LIMIT; ) {
                const limit = Math.min(
                    GuideState.FOLLOWING_TITLE_PAGE_SIZE,
                    GuideState.FOLLOWING_TITLE_FETCH_LIMIT - offset,
                );
                const result = await this.seriesApiModel.list({ offset: offset, limit: limit });
                for (const item of result.items) titles.add(item.normalizedTitle);
                offset += limit;
                if (result.items.length < limit || offset >= result.total) break;
            }
            this.followingTitleSet = titles;
        } catch (err) {
            // インジケータはベストエフォート表示のため取得失敗時は非表示扱いにする
            console.error(err);
            this.followingTitleSet = null;
        }
    }

    /**
     * 番組が追いかけ中シリーズに該当するか (簡易判定)
     * @param program: apid.ScheduleProgramItem
     */
    private isFollowingProgram(program: apid.ScheduleProgramItem): boolean {
        if (this.followingTitleSet === null) {
            return false;
        }

        return this.followingTitleSet.has(normalizeSeriesTitleForGuide(program.name));
    }

    /**
     * データクリア
     */
    public clearDate(): void {
        this.displayRange = null;
        this.startAt = 0;
        this.endAt = 0;
        this.programDoms = [];
        this.programDomIndex = {};

        this.startTime = null;
        this.timeLength = 0;
        this.schedules = [];
        this.reserveIndex = {};
    }

    /**
     * 表示範囲情報の更新
     * @param baseSize: BaseSize
     */
    public setDisplayRange(baseSize: DisplayRange): void {
        this.displayRange = baseSize;
    }

    /**
     * 番組表データの取得
     * @param option
     */
    public async fetchGuide(option: FetchGuideOption): Promise<void> {
        this.regionName = null;

        // 開始時刻設定
        this.startTime = typeof option.time !== 'undefined' ? option.time : DateUtil.format(DateUtil.getJaDate(new Date()), 'YYMMddhh');
        const startAt = this.getStartTime(this.startTime);
        let endAt: number;

        if (typeof option.channelId === 'undefined') {
            // 放送局指定ではない
            endAt = startAt + option.length * 60 * 60 * 1000;

            // 表示時刻長を記録
            this.timeLength = option.length;

            this.schedules = this.filterSchedules(await this.scheduleApiModel.getSchedules(this.createScheduleOption(option, startAt, endAt)), option);

            // 地域別・系列別番組表のときはグループ名をタイトルに出す
            this.regionName =
                this.schedules.length === 0
                    ? null
                    : typeof option.affiliation !== 'undefined'
                      ? (this.schedules[0].channel.affiliation?.name ?? null)
                      : typeof option.region !== 'undefined'
                        ? (this.schedules[0].channel.region?.name ?? null)
                        : null;
        } else {
            // 放送局指定
            this.timeLength = GuideState.SINGLE_STATION_LENGTH;
            endAt = startAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000 * GuideState.SINGLE_STATION_GET_DAYS;

            const scheduleOption: apid.ChannelScheduleOption = {
                startAt: startAt,
                days: GuideState.SINGLE_STATION_GET_DAYS,
                isHalfWidth: option.isHalfWidth,
                channelId: option.channelId,
            };

            if (this.settingModel.getSavedValue().isShowOnlyFreePrograms === true) {
                scheduleOption.isFree = true;
            }

            this.schedules = await this.scheduleApiModel.getChannelSchedule(scheduleOption);
        }

        this.startAt = startAt;
        this.endAt = endAt;

        // 予約情報取得
        this.reserveIndex = await this.reserveUtil.getReserveIndex({
            startAt,
            endAt,
        });

        // 追いかけ中インジケータ用のシリーズタイトル取得 (機能フラグ・設定 OFF なら何もしない)
        await this.loadFollowingTitleSet();
    }

    /**
     * 番組表の取得条件から ScheduleOption を組み立てる
     * @param option: FetchGuideOption
     * @param startAt: apid.UnixtimeMS
     * @param endAt: apid.UnixtimeMS
     * @return apid.ScheduleOption
     */
    private createScheduleOption(option: FetchGuideOption, startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): apid.ScheduleOption {
        const scheduleOption = {
            startAt: startAt,
            endAt: endAt,
            isHalfWidth: option.isHalfWidth,
        } as apid.ScheduleOption;

        // 放送波設定
        // 放送波指定が無い場合 (全放送波・地域別番組表) はすべての放送波を対象にする
        for (const type of GuideState.BROADCAST_TYPES) {
            (scheduleOption as any)[type] = typeof option.type === 'undefined' ? true : type === option.type;
        }

        if (this.settingModel.getSavedValue().isShowOnlyFreePrograms === true) {
            scheduleOption.isFree = true;
        }

        return scheduleOption;
    }

    /**
     * 取得した番組表を表示対象だけに絞る
     * @param schedules: apid.Schedule[]
     * @param option: FetchGuideOption
     * @return apid.Schedule[]
     */
    private filterSchedules(schedules: apid.Schedule[], option: FetchGuideOption): apid.Schedule[] {
        const result = schedules.filter(s => ChannelModel.isAudioVideoService(s.channel.type));

        // 系列別番組表のときは地上波系を系列で絞り込み、キー局を先頭・以降を都道府県コード順に並べる
        if (typeof option.affiliation !== 'undefined') {
            return sortByKeyStationAndPrefecture(
                result.filter(s => typeof s.channel.affiliation !== 'undefined' && s.channel.affiliation.id === option.affiliation),
                s => s.channel,
            );
        }

        // 地域別番組表のときは地上波系を地域で絞り込む
        return typeof option.region === 'undefined' ? result : result.filter(s => typeof s.channel.region !== 'undefined' && s.channel.region.id === option.region);
    }

    /**
     * 表示中の番組表の後ろに次の時間帯を追加する (無限スクロール用)
     * @param option: FetchGuideOption
     * @return Promise<boolean> 追加できた場合は true
     */
    public async appendGuide(option: FetchGuideOption): Promise<boolean> {
        // 単局表示は横軸が日付 (8 日分固定) なので追加読み込みはしない
        if (typeof option.channelId !== 'undefined' || this.endAt === 0 || this.schedules.length === 0) {
            return false;
        }

        // 上限を超えたら打ち切る (EPG は 8 日程度先までしか無いため無制限には伸ばさない)
        if (this.timeLength >= GuideState.MAX_TIME_LENGTH) {
            return false;
        }

        const startAt = this.endAt;
        const endAt = startAt + option.length * 60 * 60 * 1000;

        const schedules = this.filterSchedules(await this.scheduleApiModel.getSchedules(this.createScheduleOption(option, startAt, endAt)), option);

        // 表示中の放送局へ番組を追加する (並び順を変えないため新しい放送局は追加しない)
        const index: { [channelId: number]: apid.Schedule } = {};
        for (const schedule of this.schedules) {
            index[schedule.channel.id] = schedule;
        }

        let addedCnt = 0;
        for (const schedule of schedules) {
            const target = index[schedule.channel.id];
            if (typeof target === 'undefined') {
                continue;
            }

            const programIds = new Set(target.programs.map(p => p.id));
            for (const program of schedule.programs) {
                // 境界をまたぐ番組は両方の取得結果に含まれるため重複を除く
                if (programIds.has(program.id) === true) {
                    continue;
                }
                target.programs.push(program);
                addedCnt++;
            }
        }

        this.endAt = endAt;
        this.timeLength += option.length;

        // 予約情報は表示範囲全体で取り直す
        this.reserveIndex = await this.reserveUtil.getReserveIndex({
            startAt: this.startAt,
            endAt: this.endAt,
        });

        return addedCnt > 0;
    }

    /**
     * 番組情報の要素を生成する
     * @param isSingleStation: boolean 単局表示か
     */
    public createProgramDoms(isSingleStation: boolean): void {
        if (this.displayRange === null) {
            throw new Error('CreateProgramDomsError');
        }

        const isHidden = this.settingModel.getSavedValue().guideMode !== 'all';
        const genreSettings = this.genreSetting.getSavedValue();

        this.programDoms = [];
        this.programDomIndex = {};
        let baseStartAt = this.startAt;
        let baseEndAt = isSingleStation === true ? baseStartAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000 : this.endAt;
        for (let i = 0; i < this.schedules.length; i++) {
            for (const program of this.schedules[i].programs) {
                const programStartAt = baseStartAt > program.startAt ? baseStartAt : program.startAt;

                // プログラム高さ位置
                const top = this.getTop(baseStartAt, programStartAt);
                // 番組高さ
                const height = this.getDiffMin(programStartAt, baseEndAt < program.endAt ? baseEndAt : program.endAt);
                if (height <= 0) {
                    continue;
                }
                // element
                const element = this.createProgramDom(
                    {
                        top,
                        left: i,
                        height: height,
                        channel: this.schedules[i].channel,
                        program: program,
                        isHidden: isHidden,
                    },
                    genreSettings,
                );

                this.programDoms.push({
                    element,
                    top,
                    left: i,
                    height,
                    isVisible: false,
                    genreLv1: typeof program.genre1 !== 'undefined' ? program.genre1 : typeof program.genre2 !== 'undefined' ? program.genre2 : program.genre3,
                });

                // dom 索引作成
                if (typeof this.programDomIndex[program.id] === 'undefined') {
                    this.programDomIndex[program.id] = [];
                }
                this.programDomIndex[program.id].push(element);
            }

            if (isSingleStation === true) {
                baseStartAt += 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000;
                baseEndAt = baseStartAt + 60 * 60 * GuideState.SINGLE_STATION_LENGTH * 1000;
            }
        }
    }

    /**
     * 番組表 DOM 生成
     * @param option: CreateProgramDomOption
     * @param isHidden: boolean
     * @return HTMLElement
     */
    private createProgramDom(option: CreateProgramDomOption, genreSettings: IGuideGenreSettingValue): HTMLElement {
        // create child
        const child: HTMLElement[] = [];
        child.push(this.createTextElement('div', { class: 'name' }, option.program.name));
        child.push(this.createTextElement('div', { class: 'time' }, DateUtil.format(DateUtil.getJaDate(new Date(option.program.startAt)), 'hh:mm')));
        if (typeof option.program.description !== 'undefined') {
            child.push(this.createTextElement('div', { class: 'description' }, option.program.description));
        }

        // class
        let genreLv1: apid.ProgramGenreLv1 | null = null;
        let classStr = 'item';
        if (typeof option.program.genre1 !== 'undefined') {
            genreLv1 = option.program.genre1;
            classStr += ` ctg-${option.program.genre1.toString(10)}`;
        } else if (typeof option.program.genre2 !== 'undefined') {
            genreLv1 = option.program.genre2;
            classStr += ` ctg-${option.program.genre2.toString(10)}`;
        } else if (typeof option.program.genre3 !== 'undefined') {
            genreLv1 = option.program.genre3;
            classStr += ` ctg-${option.program.genre3.toString(10)}`;
        } else {
            classStr += ' ctg-empty';
        }

        if (genreLv1 !== null && typeof (genreSettings as any)[genreLv1] !== 'undefined' && (genreSettings as any)[genreLv1] === false) {
            classStr += ' hide';
        }

        // 予約情報追加
        if (typeof this.reserveIndex[option.program.id] !== 'undefined') {
            const reserve = this.reserveIndex[option.program.id];
            classStr += ` ${reserve.type}`;
        }

        if (option.isHidden === true) {
            classStr += ' hidden';
        }

        // 追いかけ中インジケータ (§4.10)
        if (this.isFollowingProgram(option.program) === true) {
            classStr += ' following';
        }

        const element = this.createParentElement(
            'div',
            {
                class: classStr,
                style:
                    `height: calc(${option.height} * (var(--timescale-height) / 60));` +
                    `top: calc(${option.top} * (var(--timescale-height) / 60)); ` +
                    `left: calc(${option.left} * (var(--channel-width)));`,
                onclick: (e: Event) => {
                    const dialogOption: ProgramDialogOpenOption = {
                        channel: option.channel,
                        program: option.program,
                    };

                    // 予約情報セット
                    if (typeof this.reserveIndex[option.program.id] !== 'undefined') {
                        dialogOption.reserve = {
                            type: this.reserveIndex[option.program.id].type,
                            reserveId: this.reserveIndex[option.program.id].item.reserveId,
                            ruleId: this.reserveIndex[option.program.id].item.ruleId,
                        };
                    }
                    this.programDialogState.open(dialogOption);
                },
            },
            child,
        );

        return element;
    }

    /**
     * 子要素付き element を生成する
     * @param tag: tag
     * @param attrs: attrs
     * @param childs: childs
     * @return HTMLElement
     */
    private createParentElement(tag: string, attrs: { [key: string]: any }, childs: HTMLElement[]): HTMLElement {
        const element = document.createElement(tag);
        for (const key in attrs) {
            if (key === 'onclick') {
                element.onclick = attrs[key];
            } else {
                element.setAttribute(key, attrs[key]);
            }
        }

        // add childs
        childs.map((child: HTMLElement) => {
            element.appendChild(child);
        });

        return element;
    }

    /**
     * 子要素付き element を生成する
     * @param tag: tag
     * @param attrs: attrs
     * @param text: text
     * @return HTMLElement
     */
    private createTextElement(tag: string, attrs: { [key: string]: any }, text: string): HTMLElement {
        const element = document.createElement(tag);
        for (const key in attrs) {
            element.setAttribute(key, attrs[key]);
        }
        element.innerText = text;

        return element;
    }

    /**
     * 番組要素の表示状態を更新する
     */
    public updateVisible(): void {
        const guideMode = this.settingModel.getSavedValue().guideMode;
        if (this.displayRange === null || guideMode === 'all') {
            return;
        }

        const baseHeight = this.displayRange.baseHeight / 60;
        const topStart = this.displayRange.offsetHeight;
        const topEnd = this.displayRange.offsetHeight + this.displayRange.maxHeight;
        for (const dom of this.programDoms) {
            if (guideMode === 'sequential' && dom.isVisible === true) {
                continue;
            }
            let isVisible = true;

            // 幅方向
            if (
                (dom.left + 1) * this.displayRange.baseWidth <= this.displayRange.offsetWidth - this.displayRange.maxWidth ||
                dom.left * this.displayRange.baseWidth >= this.displayRange.maxWidth + this.displayRange.offsetWidth
            ) {
                isVisible = false;
            }

            // 高さ方向
            if (dom.top * baseHeight >= topEnd || (dom.top + dom.height) * baseHeight <= topStart) {
                isVisible = false;
            }

            // 現在の表示と違っていれば更新
            if (dom.isVisible !== isVisible) {
                dom.isVisible = isVisible;
                if (isVisible) {
                    dom.element.classList.remove('hidden');
                } else {
                    dom.element.classList.add('hidden');
                }
            }
        }
    }

    /**
     * ジャンル情報を更新する
     */
    public updateGenre(): void {
        const genreSettings = this.genreSetting.getSavedValue();

        for (const dom of this.programDoms) {
            if (typeof dom.genreLv1 === 'undefined') {
                continue;
            }

            dom.element.classList.remove('hide');
            if (typeof (genreSettings as any)[dom.genreLv1] !== 'undefined' && (genreSettings as any)[dom.genreLv1] === false) {
                dom.element.classList.add('hide');
            }
        }
    }

    /**
     * 予約状態を更新する
     * @reutn Promise<void>
     */
    public async updateReserves(): Promise<void> {
        const newReserveIndex = await this.reserveUtil.getReserveIndex({
            startAt: this.startAt,
            endAt: this.endAt,
        });

        // 古い予約情報の class を削除
        for (const programId in this.reserveIndex) {
            if (typeof this.programDomIndex[programId] === 'undefined') {
                continue;
            }

            for (const element of this.programDomIndex[programId]) {
                element.classList.remove(this.reserveIndex[programId].type);
            }
        }

        // 新しい予約情報の class を追加
        for (const programId in newReserveIndex) {
            if (typeof this.programDomIndex[programId] === 'undefined') {
                continue;
            }

            for (const element of this.programDomIndex[programId]) {
                element.classList.add(newReserveIndex[programId].type);
            }
        }

        this.reserveIndex = newReserveIndex;

        // 番組ダイアログを開いている場合は予約情報を更新する
        if (this.programDialogState.isOpen === true) {
            const programId = this.programDialogState.getProgramId();
            if (programId !== null) {
                this.programDialogState.updateReserve(
                    typeof this.reserveIndex[programId] === 'undefined'
                        ? null
                        : {
                              type: this.reserveIndex[programId].type,
                              reserveId: this.reserveIndex[programId].item.reserveId,
                              ruleId: this.reserveIndex[programId].item.ruleId,
                          },
                );
            }
        }
    }

    /**
     * 番組情報の表示位置を返す
     * @param startAt: UnixtimeMS 番組表開始時刻
     * @param programStartAt: UnixtimeMS 番組データ開始時刻
     * @return number
     */
    private getTop(startAt: apid.UnixtimeMS, programStartAt: apid.UnixtimeMS): number {
        return startAt === programStartAt ? 0 : Math.ceil(Math.floor((programStartAt - startAt) / 1000) / 60);
    }

    /**
     * startAt と endAt の差分を分で返す
     * @param startAt: UnixtimeMS
     * @param endAt: UnixtimeMS
     * @return number
     */
    private getDiffMin(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS): number {
        return Math.ceil((endAt - startAt) / 60 / 1000);
    }

    /**
     * 引数で渡した時刻文字列 (YYMMddhh) を を UnixtimeMS に変換する
     * @param timeStr: string | null
     * @return UnixtimeMS
     */
    private getStartTime(timeStr: string | null): apid.UnixtimeMS {
        if (timeStr === null) {
            throw new Error('StartTimeOptionIsNull');
        }

        return new Date(`20${timeStr.substr(0, 2)}/${timeStr.substr(2, 2)}/` + `${timeStr.substr(4, 2)} ${timeStr.substr(6, 2)}:00:00 +0900`).getTime();
    }

    /**
     * 放送局情報を返す
     * @return apid.ScheduleChannleItem[]
     */
    public getChannels(): apid.ScheduleChannleItem[] {
        return this.schedules.map(schedule => {
            return schedule.channel;
        });
    }

    /**
     * 放送局数の個数を返す
     * @return number
     */
    public getChannelsLength(): number {
        return this.schedules.length;
    }

    /**
     * 番組取得の開始時刻を返す
     */
    public getStartAt(): apid.UnixtimeMS {
        return this.startAt;
    }

    /**
     * 時刻表示用の数字配列を返す
     * @return number[]
     */
    public getTimes(): number[] {
        if (this.startTime === null || this.startTime.length === 0) {
            return [];
        }

        const start = parseInt(this.startTime.substr(6, 2), 10);
        if (isNaN(start) === true) {
            return [];
        }

        const result: number[] = [];
        for (let i = start; i < start + this.timeLength; i++) {
            result.push(i % 24);
        }

        return result;
    }

    /**
     * 時刻表示用の数字列の長さを返す
     * @return number
     */
    public getTimesLength(): number {
        return this.timeLength;
    }

    /**
     * 番組
     * @return ProgramDomItem[]
     */
    public getProgramDoms(): ProgramDomItem[] {
        return this.programDoms;
    }

    /**
     * title 取得
     * @param type?: string 放送波種別
     * @return string
     */
    public getTitle(type?: string): string {
        let title = '番組表';

        if (typeof type !== 'undefined') {
            title += type;
        }

        if (this.regionName !== null) {
            title += this.regionName;
        }

        if (this.startAt > 0) {
            title += DateUtil.format(DateUtil.getJaDate(new Date(this.startAt)), ' MM/dd(w)');
        }

        return title;
    }

    /**
     * 単局表示時の title を返す
     * @return string
     */
    public getSingleStationTitle(): string {
        return this.schedules.length === 0 ? '番組表' : this.schedules[0].channel.name;
    }
}

namespace GuideState {
    export const SINGLE_STATION_GET_DAYS = 8;
    export const SINGLE_STATION_LENGTH = 24;
    // 無限スクロールで伸ばせる表示時間の上限 (時間)。EPG は 8 日程度先までしか無い
    export const MAX_TIME_LENGTH = 24 * 8;
    // ScheduleOption の放送波キー
    export const BROADCAST_TYPES: string[] = ['GR', 'BS', 'CS', 'SKY'].concat(
        Array.from({ length: 40 }, (_, i) => `NW${i + 1}`),
    );
    // 追いかけ中インジケータ判定用に取得するシリーズ数の上限 (簡易実装のため全件走査はしない)
    export const FOLLOWING_TITLE_FETCH_LIMIT = 500;
    // GET /api/series の limit 上限。これを超える limit は 400 になるため分割して取得する
    export const FOLLOWING_TITLE_PAGE_SIZE = 100;
}

export default GuideState;
