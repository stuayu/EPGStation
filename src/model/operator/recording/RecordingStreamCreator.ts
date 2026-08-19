import * as http from 'http';
import { inject, injectable } from 'inversify';
import Mirakurun from 'mirakurun';
import { finished } from 'stream';
import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import LongTimer from '../../../util/LongTimer';
import IRecordingStreamCreator from './IRecordingStreamCreator';

interface TunerProgram {
    reserve: Reserve;
    stream: http.IncomingMessage | null;
}

interface TunerStatus {
    types: mapid.ChannelType[];
    programs: TunerProgram[];
}

interface StreamSession {
    stream: http.IncomingMessage;
    // 予約終了ハードタイマー。legacy program stream は Mirakurun 任せなので null のまま
    timer: LongTimer | null;
}

@injectable()
export default class RecordingStreamCreator implements IRecordingStreamCreator {
    private log: ILogger;
    private configuration: IConfiguration;
    private mirakurunClientModel: IMirakurunClientModel;
    private tuners: TunerStatus[] = [];
    // tuner 割当が無い競合予約も含め、service stream の寿命を stream 実体単位で管理する
    private streamIndex: { [key: number]: StreamSession } = {};
    private closeReasonIndex = new WeakMap<http.IncomingMessage, Exclude<IRecordingStreamCreator.CloseReason, null>>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IMirakurunClientModel')
        mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.log = logger.getLogger();
        this.configuration = configuration;
        this.mirakurunClientModel = mirakurunClientModel;
    }

    /**
     * tuner 情報セット
     * @param tuners: mapid.TunerDevice[]
     */
    public setTuner(tuners: mapid.TunerDevice[]): void {
        // 一度だけ tuner 情報をセット
        if (this.tuners.length !== 0) {
            return;
        }

        this.tuners = tuners.map(tuner => {
            return {
                types: tuner.types,
                programs: [],
            };
        });

        // 念の為 30 分毎ににゴミを削除
        setInterval(
            () => {
                const now = new Date().getTime();
                for (const tuner of this.tuners) {
                    tuner.programs = tuner.programs.filter(p => {
                        return now - p.reserve.endAt < 12 * 60 * 60 * 1000;
                    });
                }
            },
            30 * 60 * 1000,
        );
    }

    /**
     * 指定した reserveId の情報を削除する
     * @param reserveId: apid.ReserveId
     */
    private deleteReserve(reserveId: apid.ReserveId, expectedStream: http.IncomingMessage): void {
        const session = this.streamIndex[reserveId];
        if (session?.stream === expectedStream) {
            session.timer?.clear();
            delete this.streamIndex[reserveId];
        }

        for (const tuner of this.tuners) {
            for (let i = tuner.programs.length - 1; i >= 0; i--) {
                if (tuner.programs[i].reserve.id === reserveId && tuner.programs[i].stream === expectedStream) {
                    tuner.programs.splice(i, 1);
                    this.log.system.debug(`delete stream: ${reserveId}`);
                }
            }
        }
    }

    /**
     * stream を生成する
     * @param reserve: Reserve
     * @return Promise<http.IncomingMessage>
     */
    public async create(reserve: Reserve, abortSignal?: AbortSignal): Promise<http.IncomingMessage> {
        if (reserve.isConflict === true) {
            // tuner の割当がないのでそのままストリームを取得
            const managedEnd = this.usesManagedEnd(reserve);
            const stream = await this.getStream(reserve, abortSignal);
            this.registerStream(reserve, stream, managedEnd);
            return stream;
        }

        const tunerId = await this.getTunerId(reserve);
        if (tunerId === null) {
            // 割り当てられる tuner がなかった
            this.log.system.warn(`TunerAssignmentError programId: ${reserve.id}`);
            const managedEnd = this.usesManagedEnd(reserve);
            const stream = await this.getStream(reserve, abortSignal);
            this.registerStream(reserve, stream, managedEnd);
            return stream;
        }

        // stream 取得
        const managedEnd = this.usesManagedEnd(reserve);
        const stream = this.getStream(reserve, abortSignal);

        // create tuner program
        const tunerProgram: TunerProgram = {
            reserve: reserve,
            stream: null,
        };

        // tuner に追加
        this.tuners[tunerId].programs.push(tunerProgram);

        try {
            // stream 登録
            const s = await stream;
            tunerProgram.stream = s;
            this.registerStream(reserve, s, managedEnd);
        } catch (err: any) {
            const index = this.tuners[tunerId].programs.indexOf(tunerProgram);
            if (index !== -1) this.tuners[tunerId].programs.splice(index, 1);
            throw err;
        }

        return stream;
    }

    /**
     * 割当可能な tunerId を返す
     * @param reserve: ReserveProgram
     * @return Promise<number | null>
     */
    private async getTunerId(reserve: Reserve): Promise<number | null> {
        // tuner に空きがないかチェック
        for (let i = 0; i < this.tuners.length; i++) {
            // tuner の放送波が一致 && 録画していない or channel が同一
            if (
                this.tuners[i].types.indexOf(<any>reserve.channelType) !== -1 &&
                (this.tuners[i].programs.length === 0 || this.tuners[i].programs[0].reserve.channel === reserve.channel)
            ) {
                return i;
            }
        }

        // 末尾を削ることで終了できる tuner を探す
        const now = new Date().getTime();
        for (let i = 0; i < this.tuners.length; i++) {
            if (this.tuners[i].types.indexOf(<any>reserve.channelType) !== -1) {
                let isOk = true;
                for (const p of this.tuners[i].programs) {
                    if (p.reserve.allowEndLack === false || p.reserve.endAt - now > IRecordingStreamCreator.PREP_TIME) {
                        isOk = false;
                        break;
                    }
                }

                // 末尾が削れない or 終了時刻が合わない
                if (isOk === false) {
                    continue;
                }

                // Mirakurun から最新の番組情報を取得して延長がないか確認
                const mirakurun = this.mirakurunClientModel.getClient();
                for (const p of this.tuners[i].programs) {
                    // 時刻指定予約はスキップ
                    if (p.reserve.programId === null) {
                        continue;
                    }

                    try {
                        const newProgram = await mirakurun.getProgram(p.reserve.programId);
                        if (newProgram.startAt + newProgram.duration - now > IRecordingStreamCreator.PREP_TIME) {
                            // 延長があった
                            isOk = false;
                            break;
                        }
                    } catch (err: any) {
                        this.log.system.warn(`tuner program get error: ${p.reserve.id}`);
                    }
                }

                // 延長があった
                if (isOk === false) {
                    continue;
                }

                // ストリーム停止
                for (const p of this.tuners[i].programs) {
                    if (p.stream !== null) {
                        p.stream.destroy();
                        p.stream.push(null); // eof 通知
                    }
                }

                // program 削除
                this.tuners[i].programs = [];

                return i;
            }
        }

        // 割り当てられる tuner が無かった
        return null;
    }

    /**
     * ストリーム取得
     * @param reserve: ReserveProgram
     * @return Promise<http.IncomingMessage>
     */
    private getStream(reserve: Reserve, abortSignal?: AbortSignal): Promise<http.IncomingMessage> {
        const mirakurun = this.mirakurunClientModel.getClient();
        const config = this.configuration.getConfig();
        const priority = reserve.isConflict ? config.conflictPriority : config.recPriority;
        this.log.system.info(
            `recording stream request: reserveId: ${reserve.id}, programId: ${reserve.programId ?? 'time-specified'},` +
                ` channelId: ${reserve.channelId}, priority: ${priority},` +
                ` mode: ${reserve.programId === null ? 'service' : (config.recording?.programStreamMode ?? 'service')}`,
        );

        if (reserve.programId === null) {
            // 時刻指定予約
            return this.getTimeSpecifiedStream(reserve, mirakurun, priority, abortSignal);
        } else {
            // programId 予約も既定ではサービスストリームを使い、EIT 境界を Recorder 側で管理する。
            if (config.recording?.programStreamMode === 'program') {
                return mirakurun.getProgramStream({
                    id: reserve.programId,
                    decode: true,
                    priority: priority,
                    signal: abortSignal,
                });
            }
            return mirakurun.getServiceStream({
                id: reserve.channelId,
                decode: true,
                priority: priority,
                signal: abortSignal,
            });
        }
    }

    /**
     * 時刻指定予約の stream を返す
     * @param reserve: Reserve
     * @param mirakurun: Mirakurun
     * @return Promise<http.IncomingMessage>
     */
    private async getTimeSpecifiedStream(
        reserve: Reserve,
        mirakurun: Mirakurun,
        priority: number,
        abortSignal?: AbortSignal,
    ): Promise<http.IncomingMessage> {
        if (reserve.endAt < new Date().getTime()) {
            // 終了時刻が過ぎていないかチェック
            throw new Error('TimeSpecifiedStreamTimeoutError');
        }

        // mirakurun から channel stream を受け取る
        const channelStream = await mirakurun
            .getServiceStream({ id: reserve.channelId, decode: true, priority: priority, signal: abortSignal })
            .catch(err => {
                this.log.system.error(`stream get error ${reserve.channelId}`);
                this.log.system.error(err);
                throw err;
            });

        // EDCB と同様、録画開始前にチャンネルを開いた状態で EIT[p/f] を取得する。
        // ここで予約時刻まで待つと、RecordingStartGate が前番組の延長や早始まりを
        // 判定できる時間がなくなる。呼び出し側がデータを消費しながら開始を判定する。
        return channelStream;
    }

    /**
     * stream 停止
     * @param reserve: Reserve
     */
    private destroyStream(reserve: Reserve): void {
        const session = this.streamIndex[reserve.id];
        const stream = session?.stream ?? null;
        if (session !== undefined) {
            session.timer?.clear();
            session.timer = null;
        }

        if (stream !== null) {
            this.closeReasonIndex.set(stream, 'scheduled-end');
            stream.destroy();
            stream.push(null); // eof 通知
        }
    }

    /** 予約終了時刻 + margin のハードタイマーを設定する */
    private setEndTimer(reserve: Reserve, session: StreamSession): void {
        const delay =
            reserve.endAt - new Date().getTime() + 1000 * this.configuration.getConfig().timeSpecifiedEndMargin;
        // 数週間先の時刻指定予約でも setTimeout の 32bit 上限で即発火しないようにする。
        // timer は張り直すたびに作り直し、下の同一性チェックで古い発火を弾けるようにする
        session.timer?.clear();
        const timer = new LongTimer();
        session.timer = timer;
        timer.set(
            () => {
                // clear と同時に発火した古い timer が新しい session を閉じないようにする
                if (this.streamIndex[reserve.id] !== session || session.timer !== timer) return;
                this.destroyStream(reserve);
            },
            Math.max(0, delay),
        );
    }

    /** 取得した stream を寿命管理へ登録する */
    private registerStream(reserve: Reserve, stream: http.IncomingMessage, managedEnd: boolean): void {
        const oldSession = this.streamIndex[reserve.id];
        if (oldSession !== undefined && oldSession.stream !== stream) {
            oldSession.timer?.clear();
            oldSession.stream.destroy();
            oldSession.stream.push(null);
        }
        const session: StreamSession = { stream, timer: null };
        this.streamIndex[reserve.id] = session;
        // legacy program stream は Mirakurun 自身が番組終了境界を管理する
        if (managedEnd) {
            this.setEndTimer(reserve, session);
        }
        finished(stream, {}, err => {
            // 予定終了で自ら destroy した場合は premature close になるため error 扱いしない
            if (err && this.closeReasonIndex.get(stream) === undefined) {
                this.log.system.error(`RecordingStreamCreator stream error: ${reserve.id}`);
                this.log.system.error(err);
            }
            this.deleteReserve(reserve.id, stream);
        });
    }

    /**
     * 時刻指定予約の endAt を変更する
     * @param reserve
     */
    public changeEndAt(reserve: Reserve): void {
        const session = this.streamIndex[reserve.id];
        if (session === undefined || session.timer === null) {
            throw new Error('StreamChangeAtError');
        }

        // timer 再設定
        this.setEndTimer(reserve, session);
    }

    /**
     * stream が予約終了ハードタイマーで閉じられたかを返す
     * @param stream: http.IncomingMessage
     * @return IRecordingStreamCreator.CloseReason
     */
    public getCloseReason(stream: http.IncomingMessage): IRecordingStreamCreator.CloseReason {
        return this.closeReasonIndex.get(stream) ?? null;
    }

    /** 現在設定で EPGStation が終了境界を管理する stream か */
    private usesManagedEnd(reserve: Reserve): boolean {
        return reserve.programId === null || this.configuration.getConfig().recording?.programStreamMode !== 'program';
    }
}
