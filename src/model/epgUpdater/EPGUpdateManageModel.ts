import { EventSource } from 'eventsource';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as mapid from '../../../node_modules/mirakurun/api';
import IChannelDB from '../db/IChannelDB';
import IChannelTypeIndex from '../db/IChannelTypeHash';
import IProgramDB, { ProgramKeepOption } from '../db/IProgramDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IMirakurunClientModel from '../IMirakurunClientModel';
import { resolveEndAt } from '../../util/ProgramDuration';
import { formatDurationUndefinedChange, formatLogDuration, formatTimeChange } from '../../util/ProgramTimeLog';
import Program from '../../db/entities/Program';
import ChannelUtil from '../../util/ChannelUtil';
import { detectOnAirPrograms, OnAirDetectResult } from './OnAirProgramDetector';
import { classifyProgramEvent, ProgramUpdatePriorityOption, splitUrgentProgramEvents } from './ProgramUpdatePriority';
import { buildProgramUpdateNotice, hasProgramUpdateNotice, DeletedProgramRange } from './ProgramUpdateNotice';
import { createOnAirProgramSnapshot, findChangedOnAirChannels } from './OnAirProgramSnapshot';
import { resolveEPGRealtimeConfig } from './EPGRealtimeConfig';
import IEPGUpdateManageModel, {
    ProgramBaseEvent,
    UpdateEvent,
    RemoveEvent,
    RedefineEvent,
    SaveProgramOption,
    ServiceEvent,
    EPGUpdateEvent,
    TunerServerType,
} from './IEPGUpdateManageModel';
import IEitPresentStore from '../service/stream/util/IEitPresentStore';

// EIT[p/f] 追従ログの対象 (検出結果 + 元の番組情報)
type OnAirLogTarget = OnAirDetectResult<{
    channelId: number;
    startAt: number;
    duration: number;
    source: mapid.Program;
}>;

@injectable()
class EPGUpdateManageModel extends EventEmitter implements IEPGUpdateManageModel {
    private log: ILogger;
    private mirakurunClient: mirakurun;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    private programQueue: ProgramBaseEvent[] = [];
    private serviceQueue: ServiceEvent[] = [];

    // 放送局索引情報
    private channelIndex: IChannelTypeIndex = {};

    // ログ表示用の放送局名索引 (channelId -> 放送局名)
    private channelNameIndex: { [channelId: number]: string } = {};

    // 除外放送局索引情報
    private excludeChannelIndex: { [channelId: number]: boolean } = {};
    private excludeSidIndex: { [serviceId: number]: boolean } = {};

    // mirakurun or mirakc の識別
    private tunerServerType: TunerServerType | null = null;
    private updatedOnAirServiceIds: { [serviceId: mapid.ServiceId]: boolean } = {};
    private updateServiceIds: { [serviceId: mapid.ServiceId]: boolean } = {};
    private mirakurunPath: string;
    private configuration: IConfiguration;

    constructor(
        @inject('ILoggerModel') loggerModel: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IMirakurunClientModel')
        mirakurunClientModel: IMirakurunClientModel,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IEitPresentStore') eitPresentStore?: IEitPresentStore,
    ) {
        super();

        this.log = loggerModel.getLogger();
        this.mirakurunClient = mirakurunClientModel.getClient();
        this.channelDB = channelDB;
        this.programDB = programDB;
        this.configuration = configuration;
        eitPresentStore?.onChange((channelId, event) => {
            this.emit(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED, [channelId]);
            this.emit(EPGUpdateEvent.PROGRAM_RANGE_UPDATED, {
                programIds: [channelId * 100000 + event.eventId],
                channelIds: [channelId],
                startAt: event.startAt,
                endAt:
                    event.startAt === null || event.durationSec === null
                        ? null
                        : event.startAt + event.durationSec * 1000,
            });
        });

        // 除外放送局索引情報のセット
        const config = configuration.getConfig();
        if (typeof config.excludeChannels !== 'undefined') {
            for (const c of config.excludeChannels) {
                this.excludeChannelIndex[c] = true;
            }
        }
        if (typeof config.excludeSids !== 'undefined') {
            for (const c of config.excludeSids) {
                this.excludeSidIndex[c] = true;
            }
        }
        this.mirakurunPath = config.mirakurunPath;
    }

    /**
     * 番組情報全件更新処理
     */
    public async updateAll(): Promise<void> {
        await this.updateChannels();
        const onAirNow = Date.now();
        const beforeOnAir = createOnAirProgramSnapshot(
            await this.programDB.findBroadcasting({ isHalfWidth: false, includeNextProgram: true }),
            onAirNow,
        );

        // タイムアウト設定。
        // NOTE: setTimeout のコールバック内で throw しても呼び出し元の try/catch では
        // 捕まらず未捕捉例外になるため、reject する Promise と race させる
        let timeout: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                this.log.system.error('update all timeout');
                reject(new Error('EPGUpdateAllTimeoutError'));
            }, EPGUpdateManageModel.UPDATE_ALL_TIMEOUT);
        });
        const clearTimeoutIfNeeded = (): void => {
            if (timeout !== null) {
                clearTimeout(timeout);
                timeout = null;
            }
        };

        this.log.system.info('get programs');
        const programs = await Promise.race([this.mirakurunClient.getPrograms(), timeoutPromise]).catch(err => {
            this.log.system.error('get programs error');
            this.log.system.error(err);
            clearTimeoutIfNeeded();
            throw err;
        });
        this.log.system.info(`Successfully retrieved ${programs.length} program(s).`);

        // メインの番組情報だけ取り出す
        const insertPrograms = programs.filter(p => {
            return this.isMainProgram(p);
        });

        this.log.system.debug(`Filtered and retrieved ${insertPrograms.length} program(s).`);
        this.log.system.info('start update programs');
        await Promise.race([
            this.programDB.insert(this.channelIndex, insertPrograms, [], this.createProgramKeepOption()),
            timeoutPromise,
        ]).catch(err => {
            this.log.system.error('update programs error');
            this.log.system.error(err);
            clearTimeoutIfNeeded();
            throw err;
        });
        this.log.system.info('done update programs');

        const afterOnAir = createOnAirProgramSnapshot(
            await this.programDB.findBroadcasting({ isHalfWidth: false, includeNextProgram: true }),
            onAirNow,
        );
        const changedOnAirChannels = findChangedOnAirChannels(beforeOnAir, afterOnAir);
        if (changedOnAirChannels.length > 0) {
            this.emit(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED, changedOnAirChannels);
        }
        // 全件更新では差分範囲を求められないため、クライアントへ再取得を指示する。
        this.emit(EPGUpdateEvent.PROGRAM_RANGE_UPDATED, {
            programIds: [],
            channelIds: [],
            startAt: null,
            endAt: null,
        });

        clearTimeoutIfNeeded();
    }

    /** サービス単位で Mirakurun の番組を取得し、既存の保存・通知経路へ流す。 */
    public async updateProgramsByChannels(channelIds: number[]): Promise<void> {
        const channels = await this.channelDB.findAll();
        const targets = channels.filter(channel => channelIds.includes(channel.id));
        const programs: mapid.Program[] = [];
        for (const channel of targets) {
            const values = await this.mirakurunClient.getPrograms({
                networkId: channel.networkId,
                serviceId: channel.serviceId,
            });
            programs.push(...values.filter(program => this.isMainProgram(program)));
        }
        if (programs.length === 0) return;
        const now = Date.now();
        const before = createOnAirProgramSnapshot(
            await this.programDB.findBroadcasting({ isHalfWidth: false, includeNextProgram: true }),
            now,
        );
        // insert() は deleteChannelIds が空だと全件削除するため、差分更新経路を使う。
        await this.programDB.update(this.channelIndex, { insert: programs, update: [], delete: [] });
        const after = createOnAirProgramSnapshot(
            await this.programDB.findBroadcasting({ isHalfWidth: false, includeNextProgram: true }),
            now,
        );
        const changed = findChangedOnAirChannels(before, after);
        if (changed.length > 0) this.emit(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED, changed);
        this.emit(EPGUpdateEvent.PROGRAM_RANGE_UPDATED, {
            programIds: programs.map(program => program.id),
            channelIds: [
                ...new Set(programs.map(program => this.channelIndex[program.networkId]?.[program.serviceId]?.id)),
            ].filter((id): id is number => typeof id === 'number'),
            startAt: null,
            endAt: null,
        });
    }

    /**
     * relatedItems からメインの番組情報か判定する
     * @param program: mapid.Program
     * @returns boolean true ならメインの番組
     */
    private isMainProgram(program: mapid.Program): boolean {
        if (typeof program.relatedItems === 'undefined') {
            return true;
        }

        let isOnlyRelayType = true;
        for (const item of program.relatedItems) {
            // Mirakurun 3.8 以下では type が存在しない && relatedItems が機能していないので true を返す
            if (typeof item.type === 'undefined') {
                return true;
            }

            // 移動したイベントか？
            if (item.type === 'movement') {
                return true;
            }

            // リレーの場合は無視
            if (item.type === 'relay') {
                continue;
            }

            // issue #681
            // shared が存在するなら false にする
            isOnlyRelayType = false;

            // type が shared でメインの放送か？
            if (item.eventId === program.eventId && item.serviceId === program.serviceId) {
                return true;
            }
        }

        // issue #681
        // type が relay だけしか存在しないものは true とする
        if (isOnlyRelayType === true) {
            return true;
        }

        return false;
    }

    /**
     * 放送局情報更新
     */
    public async updateChannels(): Promise<void> {
        this.log.system.info('get service');
        let services = await this.mirakurunClient.getServices().catch(err => {
            this.log.system.error('get service error');
            this.log.system.error(err);
            throw err;
        });

        // 無効なサービスを削除する
        // service_type 0 (未定義) や serviceId 0 のサービスは放送されていない枠で、
        // 全サービスを列挙して返すチューナーサーバ (recisdb-proxy 等) が混ぜてくることがある
        const beforeInvalidFilter = services.length;
        services = services.filter(s => {
            return s.serviceId !== 0 && (typeof (s as any).type !== 'number' || (s as any).type !== 0);
        });
        if (beforeInvalidFilter !== services.length) {
            this.log.system.info(`exclude invalid services: ${beforeInvalidFilter - services.length}`);
        }

        // 除外索引に含まれる放送局を削除
        services = services.filter(s => {
            return (
                typeof this.excludeChannelIndex[s.id] === 'undefined' &&
                typeof this.excludeSidIndex[s.serviceId] === 'undefined'
            );
        });

        this.log.system.info('start update channel');
        await this.channelDB.insert(services).catch(err => {
            this.log.system.error('update channel error');
            this.log.system.error(err);
            throw err;
        });
        this.log.system.info('done update channel');

        // 過去に取り込んでしまった無効なサービスを掃除する
        const deletedCount = await this.channelDB.deleteInvalidChannels().catch(err => {
            this.log.system.error('delete invalid channel error');
            this.log.system.error(err);

            return 0;
        });
        if (deletedCount > 0) {
            this.log.system.info(`delete invalid channels: ${deletedCount}`);
        }

        // 放送局索引作成
        this.channelIndex = {};
        this.channelNameIndex = {};
        this.updateChannelIndex(services);
    }

    /**
     * 放送局索引更新
     * @param services: Service[]
     * @return void
     */
    private updateChannelIndex(services: mapid.Service[]): void {
        let invalidChannelCount = 0;
        let invalidChannelSummary: string | null = null;

        for (const service of services) {
            if (typeof service.channel === 'undefined' || service.channel === null) {
                continue;
            }

            const channel = ChannelUtil.resolvePhysicalChannel(
                service.channel as mapid.Channel[] | mapid.Channel | undefined,
            );

            if (typeof channel === 'undefined' || channel === null || typeof channel.type === 'undefined') {
                invalidChannelCount += 1;
                if (invalidChannelCount === 1) {
                    invalidChannelSummary = `(networkId=${service.networkId}, serviceId=${service.serviceId}, name=${service.name})`;
                }
                continue;
            }

            if (typeof this.channelIndex[service.networkId] === 'undefined') {
                this.channelIndex[service.networkId] = {};
            }
            this.channelIndex[service.networkId][service.serviceId] = {
                id: service.id,
                type: channel.type,
                channel: channel.channel,
            };
            // ログで放送局を判別できるようにする
            this.channelNameIndex[service.id] = service.name;
        }

        if (invalidChannelCount > 0 && invalidChannelSummary !== null) {
            this.log.system.warn(
                `skip channel index update: invalid channel data (${invalidChannelCount} services skipped; example: ${invalidChannelSummary})`,
            );
        }
    }

    /**
     * チューナーサーバの種別のチェック
     * config.yml の tunerServerType で明示指定されていればそれを優先し、判定を行わない。
     * 'auto' (省略時既定) では getServerConfig() の成否で判定する。
     * - 成功: mirakurun と判定してキャッシュする
     * - 404 / 501 等「エンドポイントが存在しない」ことを示す応答: mirakc と判定してキャッシュする
     * - 接続不能・タイムアウト・5xx 等の一時的な失敗: mirakc とみなして返すが、
     *   確定した判定ではないためキャッシュしない (次回呼び出し時に再判定する)
     * @returns Promise<TunerServerType>
     */
    public async checkTunerServerType(): Promise<TunerServerType> {
        if (this.tunerServerType !== null) {
            return this.tunerServerType;
        }

        const configured = this.configuration.getConfig().tunerServerType;
        if (configured === 'mirakurun' || configured === 'mirakc') {
            this.tunerServerType = configured === 'mirakurun' ? TunerServerType.mirakurun : TunerServerType.mirakc;
            this.log.system.info(`tuner server type is fixed to "${configured}" by config.yml (tunerServerType)`);

            return this.tunerServerType;
        }

        // getServerConfig() の実行の可否で判定を行う
        try {
            await this.mirakurunClient.getServerConfig();
            this.tunerServerType = TunerServerType.mirakurun;
            this.log.system.info('tuner server type: mirakurun (getServerConfig() succeeded)');
        } catch (err: any) {
            const kind = EPGUpdateManageModel.classifyTunerServerError(err);
            if (kind === 'incompatible') {
                this.tunerServerType = TunerServerType.mirakc;
                this.log.system.info(
                    `tuner server type: mirakc (getServerConfig() responded that the endpoint does not exist: ${EPGUpdateManageModel.describeError(err)})`,
                );
            } else {
                // 一時的な失敗とみなし、判定は確定させずキャッシュしない (次回呼び出しで再判定する)
                this.log.system.warn(
                    `failed to check tuner server type (treated as transient, will retry next time): ${EPGUpdateManageModel.describeError(err)}`,
                );

                return TunerServerType.mirakc;
            }
        }

        return this.tunerServerType;
    }

    /**
     * getServerConfig() 失敗時のエラーを分類する
     * - 'incompatible': 404 / 501 のように、そのエンドポイントが存在しないと判断できる応答、
     *   または docs の内容が Mirakurun と一致せず operationId を解決できなかった場合
     * - 'transient': 接続不能・タイムアウト・5xx など、一時的な失敗とみなせる場合
     * @param err: any
     * @return 'incompatible' | 'transient'
     */
    private static classifyTunerServerError(err: any): 'incompatible' | 'transient' {
        // mirakurun クライアントの call() は docs は取得できたが operationId が
        // 見つからない場合、Error("operationId \"xxx\" is not found.") を投げる。
        // これは docs の内容が Mirakurun の API 定義と一致しないことを意味するため
        // エンドポイントが存在しないのと同様に扱う
        if (typeof err?.message === 'string' && EPGUpdateManageModel.OPERATION_ID_NOT_FOUND_REGEXP.test(err.message)) {
            return 'incompatible';
        }

        // mirakurun クライアントの ErrorResponse (または同形の応答) は status を持つ。
        // 404 / 501 は「そのエンドポイントが無い」ことを示す応答、
        // それ以外 (接続不能を示す -1、5xx 等) は一時的な失敗として扱う
        const status = typeof err?.status === 'number' ? err.status : undefined;
        if (status === 404 || status === 501) {
            return 'incompatible';
        }

        return 'transient';
    }

    /**
     * ログ出力用にエラーの概要を組み立てる
     * @param err: any
     * @return string
     */
    private static describeError(err: any): string {
        if (typeof err?.message === 'string') {
            return err.message;
        }
        if (typeof err?.status === 'number') {
            return `status: ${err.status}${typeof err?.statusText === 'string' ? ` ${err.statusText}` : ''}`;
        }

        return String(err);
    }

    /**
     * event stream の解析を開始する
     */
    public async start(): Promise<void> {
        if (this.tunerServerType === null) {
            await this.checkTunerServerType();
        }

        if (this.tunerServerType === TunerServerType.mirakurun) {
            // mirakurun event stream 解析開始
            return this.startAnalayzingMirakurunEvents();
        } else {
            // mirakc イベント通知解析開始
            return this.startAnalyzingMirakcEvents();
        }
    }

    /**
     * mirakurun の event stream の解析を開始する
     */
    private async startAnalayzingMirakurunEvents(): Promise<void> {
        this.log.system.info('start get stream');

        const eventStream = await this.mirakurunClient.getEventsStream().catch(err => {
            this.log.system.error('event stream get error');
            this.log.system.error(err);
            this.stopStream(eventStream);
            this.emit(EPGUpdateEvent.STREAM_NO_EVENT);
            throw err;
        });

        this.emit(EPGUpdateEvent.STREAM_STARTED);

        return new Promise<void>(async (_resolve: () => void, reject: (err: Error) => void) => {
            let receivedEvent = false;
            const warnIfNoEvent = (): void => {
                if (receivedEvent === false) {
                    this.log.system.warn(
                        'event stream disconnected without receiving any event; a reverse proxy may be buffering the stream',
                    );
                    this.emit(EPGUpdateEvent.STREAM_NO_EVENT);
                }
            };

            // エラー処理
            eventStream.once('error', err => {
                this.log.system.error('event stream error');
                this.log.system.error(err);
                warnIfNoEvent();
                this.stopStream(eventStream);
                this.emit(EPGUpdateEvent.STREAM_ABORTED);
                reject(err);
            });

            eventStream.once('end', () => {
                this.log.system.error('event stream is ended');
                warnIfNoEvent();
                this.stopStream(eventStream);
                this.emit(EPGUpdateEvent.STREAM_ABORTED);
                reject(new Error('EndedEventStream'));
            });

            eventStream.once('close', () => {
                this.log.system.error('event stream is closed');
                warnIfNoEvent();
                this.stopStream(eventStream);
                this.emit(EPGUpdateEvent.STREAM_ABORTED);
                reject(new Error('ClosedEventStream'));
            });

            // イベント受信処理
            let tmp = Buffer.from([]);
            eventStream.on('data', chunk => {
                // tmp の末尾が [\n の場合無視
                if (Buffer.compare(chunk, EPGUpdateManageModel.START_STRING) === 0) {
                    return;
                }

                tmp = Buffer.concat([tmp, chunk]);

                // tmp の末尾が },\n かチェック
                if (
                    Buffer.compare(
                        tmp.slice(tmp.length - EPGUpdateManageModel.DATA_DELIMITER_STRING.length, tmp.length),
                        EPGUpdateManageModel.DATA_DELIMITER_STRING,
                    ) !== 0
                ) {
                    // JSON parse 可能ではない
                    return;
                }

                try {
                    // event 情報をパースして queue に積む
                    this.log.system.debug(String(tmp));
                    const events: mapid.Event[] = <mapid.Event[]>JSON.parse(`[${String(tmp).slice(0, -3)}]`);
                    receivedEvent = receivedEvent || events.length > 0;
                    for (const event of events) {
                        if (event.resource === 'program') {
                            this.enqueueProgramEvent(<any>event);
                        } else if (event.resource === 'service') {
                            this.serviceQueue.push(<any>event);
                        }
                    }
                    this.log.system.debug('OK');
                } catch (err: any) {
                    this.log.system.error('event stream parse error');
                    const tmpHex = tmp.toString('hex').match(/../g);
                    if (tmpHex !== null) {
                        this.log.system.debug(tmpHex.join(' '));
                    }
                    this.log.system.error(err);
                    this.stopStream(eventStream);
                    this.emit(EPGUpdateEvent.STREAM_ABORTED);
                    reject(new Error('EventStreamParseError'));
                }
                tmp = Buffer.from([]);
            });
        });
    }

    /**
     * mirakc の /events の解析を開始する
     */
    private async startAnalyzingMirakcEvents(): Promise<void> {
        this.log.system.info('start analyzing events');

        let sse: EventSource;
        try {
            sse = new EventSource(new URL('/events', this.mirakurunPath).href);
        } catch (err) {
            this.log.system.error('failed to analyzing events');
            this.log.system.error(err);
            throw err;
        }

        // open 時の処理
        let isEventsOpend = false;
        let receivedEvent = false;
        sse.onopen = () => {
            isEventsOpend = true;
            this.emit(EPGUpdateEvent.STREAM_STARTED);
        };

        // 放映中プログラムの更新
        sse.addEventListener('onair.program-changed', ev => {
            receivedEvent = true;
            const { serviceId } = JSON.parse(ev.data as string);
            this.updatedOnAirServiceIds[serviceId] = true;
            this.log.system.debug(`mirakc update onair services: ${serviceId}`);
        });

        // プログラム更新
        let isFirst = true;
        let startTime = 0;
        sse.addEventListener('epg.programs-updated', ev => {
            receivedEvent = true;
            const now = Date.now();
            if (isFirst === true) {
                isFirst = false;
                startTime = now;
            }

            // 接続時に送信される更新情報を無視するため、開始1秒間は処理しない
            if (now - startTime <= 1000) {
                return;
            }

            const { serviceId } = JSON.parse(ev.data as string);
            this.updateServiceIds[serviceId] = true;
            this.log.system.debug(`mirakc update normal services: ${serviceId}`);
        });

        return new Promise<void>((_resolve, reject: (err: Error) => void) => {
            // エラー発生時のエラー処理の定義
            const finalize = (errorMessage: string) => {
                clearInterval(timer);
                if (isEventsOpend === true && receivedEvent === false) {
                    this.log.system.warn(
                        'event stream disconnected without receiving any event; a reverse proxy may be buffering the stream',
                    );
                    this.emit(EPGUpdateEvent.STREAM_NO_EVENT);
                }
                try {
                    sse.close();
                } catch (err) {
                    // close エラーは無視
                }
                reject(Error(errorMessage));
            };

            // エラー発生時
            sse.addEventListener('error', () => {
                this.log.system.error('disconnected mirakc event.');
                finalize('MirakcEventsClosed');
            });

            // 定期的に接続を監視する
            const timer = setInterval(() => {
                if (isEventsOpend === false) {
                    // events に接続できていない
                    this.log.system.error('events is not opened.');
                    finalize('MirakcEventsIsNotOpened');
                } else if (sse.readyState !== 1) {
                    // events が切断された
                    this.log.system.error('events has been closed.');
                    finalize('MirakcEventsClosed');
                }
            }, 1000);
        });
    }

    /**
     * event stream を止める
     * @param stream: IncomingMessage
     */
    private stopStream(stream: IncomingMessage): void {
        stream.destroy();
        stream.push(null); // eof 通知
        stream.removeAllListeners();
        this.programQueue = [];
        this.serviceQueue = [];
    }

    /**
     * 番組更新イベントをキューへ積む。
     * 即時反映が必要なイベント (災害時の特番割り込み・延長・予約に近い時間帯の変更) を
     * 受信した場合は URGENT_ENQUEUED を通知し、周期を待たずに先行フラッシュさせる
     * @param event: ProgramBaseEvent
     */
    private enqueueProgramEvent(event: ProgramBaseEvent): void {
        this.programQueue.push(event);

        const option = this.createPriorityOption();
        if (option === null) {
            return;
        }

        if (classifyProgramEvent(event, option) === 'immediate') {
            this.emit(EPGUpdateEvent.URGENT_ENQUEUED);
        }
    }

    /**
     * 緊急度判定用のオプションを作る (設定はホットリロードされるため実行時に読み直す)
     * @return ProgramUpdatePriorityOption | null 機能が無効な場合は null
     */
    private createPriorityOption(): ProgramUpdatePriorityOption | null {
        const realtime = resolveEPGRealtimeConfig(this.configuration.getConfig());
        if (realtime.enabled === false) {
            return null;
        }

        return {
            now: Date.now(),
            urgentWindowMs: realtime.urgentWindowMs,
        };
    }

    /**
     * programQueue の program を DB へ反映させる
     * @param timeThreshold: number この時刻より前に始まる番組の更新が無ければキューへ戻す (0 で無条件に反映)
     * @param option: SaveProgramOption
     */
    public async saveProgram(timeThreshold: number = 0, option?: SaveProgramOption): Promise<void> {
        // 取り出し
        const programs = option?.urgentOnly === true ? this.spliceUrgentPrograms() : this.spliceAllPrograms();
        if (programs.length === 0) {
            return;
        }
        // 先行フラッシュは緊急イベントだけを対象にするため時刻での足切りを行わない
        if (option?.urgentOnly === true) {
            timeThreshold = 0;
        }
        this.log.system.debug('number of de-queued items: %d', programs.length);

        try {
            const deleteIndex: { [programId: number]: ProgramBaseEvent } = {}; // 追加用索引
            const updateIndex: { [programId: number]: ProgramBaseEvent } = {}; // 追加用索引
            let needToSave = false;

            if (timeThreshold === 0) {
                needToSave = true;
            }

            // eventを時系列を意識して整理
            for (const event of programs) {
                if (event.type === 'create' || event.type === 'update') {
                    const program = (<UpdateEvent>event).data;
                    if (typeof program.name !== 'undefined' && this.isMainProgram(program) === true) {
                        updateIndex[program.id] = event;
                        if (program.startAt < timeThreshold) {
                            needToSave = true;
                        }

                        if (program.id in deleteIndex) {
                            // このEvent以前に受信した"remove" or "redefine" Eventは破棄する
                            delete deleteIndex[program.id];
                        }
                    }
                } else if (event.type === 'remove') {
                    const removeData = (<RemoveEvent>event).data;
                    deleteIndex[removeData.id] = event;
                    if (removeData.id in updateIndex) {
                        // このEvent以前に受信した"create" or "update" Eventは破棄する
                        delete updateIndex[removeData.id];
                    }
                } else if ((event as any).type === 'redefine') {
                    // redefine は古いバージョンをサポートするため
                    const from = (<RedefineEvent>event).data.from;
                    deleteIndex[from] = event;
                    if (from in updateIndex) {
                        // このEvent以前に受信した"create" or "update" Eventは破棄する
                        delete updateIndex[from];
                    }
                }
            }

            if (needToSave) {
                const deleteValues: Array<mapid.ProgramId> = [];
                const insertValues: Array<mapid.Program> = [];
                const updateValues: Array<mapid.Program> = [];

                for (const [_id, event] of Object.entries(deleteIndex)) {
                    deleteValues.push((<RemoveEvent>event).data.id);
                }
                for (const [_id, event] of Object.entries(updateIndex)) {
                    // create と update を分けて数える。DB 側は upsert なので扱いは同じだが、
                    // 「新規番組の create が届いているか」をログで切り分けられるようにする
                    if (event.type === 'create') {
                        insertValues.push((<UpdateEvent>event).data);
                    } else {
                        updateValues.push((<UpdateEvent>event).data);
                    }
                }

                if (deleteValues.length > 0 || insertValues.length > 0 || updateValues.length > 0) {
                    this.log.system.info('update program db start');
                    this.log.system.info({
                        deleteValues: deleteValues.length,
                        insertValues: insertValues.length,
                        updateValues: updateValues.length,
                    });

                    // 追加/更新された番組
                    const changed = [...insertValues, ...updateValues];

                    // EIT[p/f] 相当 (現在放送中 / 直後に始まる) の変更を抽出する。
                    // 視聴画面の番組情報や番組表の即時更新と、追従状況のログ出力に使う
                    const onAirTargets = detectOnAirPrograms(
                        changed.map(p => ({
                            channelId: this.channelIndex[p.networkId]?.[p.serviceId]?.id ?? 0,
                            startAt: p.startAt,
                            duration: p.duration,
                            source: p,
                        })),
                        { now: Date.now() },
                    ).filter(t => t.program.channelId !== 0);

                    // 変更前の時刻をログに併記するため、DB 更新の前に現在値を控える
                    const oldPrograms = await this.getProgramsForOnAirLog(onAirTargets);

                    // 削除される番組の放送局・時間帯も DB 更新の前に控える。
                    // これが無いと「削除だけの更新」が範囲不明の通知になり、
                    // 番組表・視聴画面が無関係な更新でも毎回取り直してしまう
                    const deletedRanges = await this.getDeletedProgramRanges(deleteValues);

                    await this.programDB.update(this.channelIndex, {
                        insert: insertValues,
                        update: updateValues,
                        delete: deleteValues,
                    });
                    this.log.system.info('update program db done');

                    // EPG 追従の記録 (§4.10 事前マッピングキャッシュのトリガーに利用)
                    this.logOnAirProgramUpdate(onAirTargets, oldPrograms);

                    this.emit(
                        EPGUpdateEvent.PROGRAM_UPDATED,
                        changed.map(p => p.id),
                    );

                    const onAirChannelIds = [...new Set(onAirTargets.map(t => t.program.channelId))].sort(
                        (a, b) => a - b,
                    );
                    if (onAirChannelIds.length > 0) {
                        this.emit(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED, onAirChannelIds);
                    }

                    // 変更のあった放送局・時間帯・番組 id を通知する。
                    // EIT[p/f] の窓 (現在〜10 分先) の外で起きた変更もここには載るため、
                    // 番組表は表示中の時間帯と重なるときだけ取り直せる (予約側は番組 id で追従する)
                    const notice = buildProgramUpdateNotice({
                        changed: changed,
                        deleted: deleteValues,
                        deletedRanges: deletedRanges,
                        getChannelId: p => this.channelIndex[p.networkId]?.[p.serviceId]?.id ?? null,
                        programIdLimit: EPGUpdateManageModel.PROGRAM_ID_NOTICE_LIMIT,
                    });
                    if (hasProgramUpdateNotice(notice) === true) {
                        this.emit(EPGUpdateEvent.PROGRAM_RANGE_UPDATED, notice);
                    }
                }
            } else {
                // 整理した結果のEventをキューへ戻す
                // NOTE: "remove"イベントは先頭へ
                this.log.system.debug(
                    'number of re-queued items: %d',
                    Object.keys(deleteIndex).length + Object.keys(updateIndex).length,
                );
                this.programQueue = Object.values(deleteIndex).concat(Object.values(updateIndex), this.programQueue);
            }
        } catch (err: any) {
            // キューへ全て戻す
            this.log.system.debug('number of re-queued items: %d', programs.length);
            this.programQueue = programs.concat(this.programQueue);
            throw err;
        }
    }

    /**
     * キューの内容をすべて取り出す
     * @return ProgramBaseEvent[]
     */
    private spliceAllPrograms(): ProgramBaseEvent[] {
        return this.programQueue.splice(0, this.programQueue.length);
    }

    /**
     * 即時反映が必要なイベントだけをキューから取り出す。
     * 同一番組に対するイベントの追い越しを防ぐため、
     * 対象の番組 id に属するイベントはまとめて取り出す
     * @return ProgramBaseEvent[]
     */
    private spliceUrgentPrograms(): ProgramBaseEvent[] {
        const option = this.createPriorityOption();
        if (option === null) {
            return [];
        }

        const split = splitUrgentProgramEvents(this.programQueue, option);
        if (split.urgent.length === 0) {
            return [];
        }

        this.programQueue = split.rest;
        this.log.system.debug('number of urgent de-queued items: %d', split.urgent.length);

        return split.urgent;
    }

    /**
     * 削除される番組の放送局・時間帯を DB から取得する。
     * 番組表・視聴画面が「表示中の内容と重なるときだけ取り直す」ための情報で、
     * DB から消える前に呼ぶ必要がある
     * @param programIds: mapid.ProgramId[] 削除される番組 id
     * @return Promise<DeletedProgramRange[]> 取得できたものだけ
     */
    private async getDeletedProgramRanges(programIds: mapid.ProgramId[]): Promise<DeletedProgramRange[]> {
        if (programIds.length === 0 || programIds.length > EPGUpdateManageModel.PROGRAM_ID_NOTICE_LIMIT) {
            return [];
        }

        try {
            const programs = await this.programDB.findIds(programIds);

            return programs.map(program => {
                return {
                    channelId: program.channelId,
                    startAt: program.startAt,
                    endAt: program.endAt,
                };
            });
        } catch (err: any) {
            // 通知の絞り込みに使うだけなので、取得できなくても更新自体は続ける
            this.log.system.debug('get deleted program ranges error');

            return [];
        }
    }

    /**
     * EIT[p/f] 追従ログ用に、更新前の番組情報を取得する
     * @param targets: OnAirLogTarget[] ログ対象
     * @return Promise<{ [programId: number]: Program }> 取得できたものだけ
     */
    private async getProgramsForOnAirLog(targets: OnAirLogTarget[]): Promise<{ [programId: number]: Program }> {
        const result: { [programId: number]: Program } = {};
        if (targets.length === 0 || targets.length > EPGUpdateManageModel.ON_AIR_LOG_LIMIT) {
            return result;
        }

        for (const target of targets) {
            const programId = target.program.source.id;
            try {
                const old = await this.programDB.findId(programId);
                if (old !== null) {
                    result[programId] = old;
                }
            } catch (err: any) {
                // ログ用途なので取得できなくても処理は続ける
                this.log.system.debug(`get old program error for log: ${programId}`);
            }
        }

        return result;
    }

    /**
     * EIT[p/f] (現在放送中 / 次の番組) の更新内容をログへ出す。
     * 開始・終了時刻は変更前 -> 変更後の形で併記する
     * @param targets: OnAirLogTarget[] ログ対象
     * @param oldPrograms: { [programId: number]: Program } 更新前の番組情報
     */
    private logOnAirProgramUpdate(targets: OnAirLogTarget[], oldPrograms: { [programId: number]: Program }): void {
        if (targets.length === 0) {
            return;
        }

        if (targets.length > EPGUpdateManageModel.ON_AIR_LOG_LIMIT) {
            this.log.system.info(
                `EIT[p/f] update: ${targets.length} program(s) on ` +
                    `${new Set(targets.map(t => t.program.channelId)).size} channel(s)` +
                    ` (details are omitted over ${EPGUpdateManageModel.ON_AIR_LOG_LIMIT})`,
            );

            return;
        }

        for (const target of targets) {
            const program = target.program.source;
            const old = oldPrograms[program.id] ?? null;
            const channelName = this.channelNameIndex[target.program.channelId] ?? 'unknown';
            const messages = [
                `EIT[p/f] ${target.section}${old === null ? ' new' : ''}:`,
                `channel: ${channelName} (${target.program.channelId})`,
                `programId: ${program.id}`,
                `eventId: ${program.eventId}`,
                `name: ${program.name ?? ''}`,
                `start: ${formatTimeChange(old === null ? null : old.startAt, program.startAt)}`,
                `end: ${formatTimeChange(old === null ? null : old.endAt, resolveEndAt(program.startAt, program.duration))}`,
                `duration: ${formatLogDuration(program.duration)}`,
            ];

            // 放送終了時刻が未定になった / 確定したことを明示する
            const durationNote = formatDurationUndefinedChange(old === null ? null : old.duration, program.duration);
            if (durationNote !== null) {
                messages.push(durationNote);
            }

            this.log.system.info(messages.join(' '));
        }
    }

    /**
     * 全件更新時に残す過去番組の条件を作る
     * @return ProgramKeepOption
     */
    private createProgramKeepOption(): ProgramKeepOption {
        const config = this.configuration.getConfig();
        const retentionTime = typeof config.epgRetentionTime === 'number' ? config.epgRetentionTime : 0;
        const now = Date.now();

        return {
            now: now,
            retentionThreshold: retentionTime < 0 ? null : now - retentionTime * 60 * 60 * 1000,
        };
    }

    /**
     * 保存期間を過ぎた過去の番組情報を削除する
     * config.yml の epgRetentionTime (時間) より前に終了した番組が対象。
     * epgRetentionTime が負数の場合は無期限保存として何もしない
     */
    public async deleteOldPrograms(): Promise<void> {
        // 設定はホットリロードされるため実行時に読み直す
        const config = this.configuration.getConfig();
        const retentionTime = typeof config.epgRetentionTime === 'number' ? config.epgRetentionTime : 0;
        if (retentionTime < 0) {
            this.log.system.debug('skip delete old program db (epgRetentionTime is unlimited)');

            return;
        }

        const threshold = Date.now() - retentionTime * 60 * 60 * 1000;
        this.log.system.info('delete old program db start');
        await this.programDB.deleteOld(threshold);
        this.log.system.info('delete old program db done');
    }

    /**
     * serviceQueue の program を DB へ反映させる
     */
    public async saveService(): Promise<void> {
        // 取り出し
        const services = this.serviceQueue.splice(0, this.serviceQueue.length);

        if (services.length === 0) {
            return;
        }

        // ロゴデータ保持判定のために放送局情報をすべて取得する
        const serviceDatas = await this.mirakurunClient.getServices().catch(err => {
            this.log.system.error('get service error');
            this.log.system.error(err);
            return [] as mapid.Service[];
        });
        const serviceDataIndex: { [serviceId: number]: mapid.Service } = {};
        for (const s of serviceDatas) {
            serviceDataIndex[s.id] = s;
        }

        const createIndex: { [serviceId: number]: mapid.Service } = {}; // 追加用索引
        const updateIndex: { [serviceId: number]: mapid.Service } = {}; // 更新用索引

        for (const service of services) {
            if (
                typeof this.excludeChannelIndex[service.data.id] !== 'undefined' ||
                typeof this.excludeSidIndex[service.data.serviceId] !== 'undefined'
            ) {
                // 除外索引に含まれる放送局を削除
                continue;
            }

            // add hasLogoData
            if (typeof serviceDataIndex[service.data.id] !== 'undefined') {
                service.data.hasLogoData = serviceDataIndex[service.data.id].hasLogoData;
            }
            switch (service.type) {
                case 'create':
                    if (typeof service.data.name !== 'undefined') {
                        createIndex[service.data.id] = service.data;
                    }
                    break;
                case 'update':
                    if (typeof service.data !== 'undefined') {
                        updateIndex[service.data.id] = service.data;
                    }
                    break;
                case 'remove':
                    // TODO 要確認
                    // throw new Error('ServiceRedefine');
                    break;
            }
        }

        const insertValues = Object.values(createIndex);
        const updateValues = Object.values(updateIndex);

        this.log.system.info('update channel db start');
        this.log.system.info({
            insertValues: insertValues.length,
            updateValues: updateValues.length,
        });

        await this.channelDB.update({
            insert: insertValues,
            update: updateValues,
        });

        // 放送局索引情報更新
        this.updateChannelIndex(insertValues);
        this.updateChannelIndex(updateValues);

        this.log.system.info('update channel db done');
        this.emit(EPGUpdateEvent.SERVICE_UPDATED);
    }

    /**
     * mirakc の /events で確認された放映中のサービスの番組情報の更新
     */
    public async saveOnAirServices(): Promise<void> {
        const channelIds = Object.keys(this.updatedOnAirServiceIds).map(str => parseInt(str, 10));

        // 更新対象が無ければ何もしない
        if (channelIds.length === 0) {
            return;
        }

        await this.saveMirakcServices(channelIds);

        // 更新したサービスを this.updatedOnAirServiceIds から削除
        for (const channelId of channelIds) {
            delete this.updatedOnAirServiceIds[channelId];
        }
    }

    /**
     * mirakc の /events で確認された更新が必要なサービスの番組情報の更新
     */
    public async saveUpdateServices(): Promise<void> {
        const channelIds = Object.keys(this.updateServiceIds).map(str => parseInt(str, 10));

        // 更新対象が無ければ何もしない
        if (channelIds.length === 0) {
            return;
        }

        await this.saveMirakcServices(channelIds);

        // 更新したサービスを this.updateServiceIds から削除
        for (const channelId of channelIds) {
            delete this.updateServiceIds[channelId];
        }
    }

    /**
     * 指定された channelId の番組情報を全件削除および全件更新する
     * @param channelIds
     */
    private async saveMirakcServices(channelIds: mapid.ServiceId[]) {
        // 番組情報を更新する前にチャンネル情報を更新する (更新する契機が存在しないため)
        await this.updateChannels();

        // 更新対象の番組情報を取得する
        this.log.system.info('get service programs');
        const insertPrograms: mapid.Program[] = [];
        for (const serviceId of channelIds) {
            const response = await fetch(new URL(`/api/services/${serviceId}/programs`, this.mirakurunPath));
            const servicePrograms: mapid.Program[] = await response.json();

            // メインプログラムだけ取り出す
            for (const p of servicePrograms) {
                if (this.isMainProgram(p) === true) {
                    insertPrograms.push(p);
                }
            }
        }

        // DB 更新
        this.log.system.info('start update service programs');
        await this.programDB.insert(this.channelIndex, insertPrograms, channelIds).catch(err => {
            this.log.system.error('update service programs error');
            this.log.system.error(err);
            throw err;
        });
        this.log.system.info('done update service programs');
    }
}

namespace EPGUpdateManageModel {
    // updateAll (Mirakurun からの全件取得 + DB 反映) の上限時間
    export const UPDATE_ALL_TIMEOUT = 10 * 60 * 1000;

    // event stream の開始文字列
    export const START_STRING = Buffer.from([0x5b, 0x0a]);
    export const DATA_DELIMITER_STRING = Buffer.from([0x7d, 0x0a, 0x2c, 0x0a]);

    // EIT[p/f] の追従ログを 1 回の更新で出す上限。
    // 全件更新直後などは対象が数百件になるため、超えたら件数だけを残す
    export const ON_AIR_LOG_LIMIT = 30;

    // 更新通知に載せる番組 id の上限。
    // これを超える更新は予約を 1 件ずつ追従させるより
    // 周期的な予約全体更新に任せたほうが安いため、番組 id を載せない
    export const PROGRAM_ID_NOTICE_LIMIT = 1000;

    // mirakurun クライアントが operationId を解決できなかったときに投げる Error のメッセージパターン。
    // docs (OpenAPI 定義) は取得できたが、その内容に対象の operationId が含まれない場合に発生する
    export const OPERATION_ID_NOT_FOUND_REGEXP = /operationId ".*" is not found\.?/;
}

export default EPGUpdateManageModel;
