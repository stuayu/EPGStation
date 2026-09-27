import * as events from 'events';
import * as fs from 'fs';
import * as http from 'http';
import { inject, injectable, optional } from 'inversify';
import * as path from 'path';
import * as stream from 'stream';
import * as mapid from '../../../../node_modules/mirakurun/api';
import * as apid from '../../../../api';
import DropLogFile from '../../../db/entities/DropLogFile';
import Recorded from '../../../db/entities/Recorded';
import RecordedHistory from '../../../db/entities/RecordedHistory';
import Reserve from '../../../db/entities/Reserve';
import VideoFile from '../../../db/entities/VideoFile';
import FileUtil from '../../../util/FileUtil';
import { formatLogTime, formatTimeChange } from '../../../util/ProgramTimeLog';
import StrUtil from '../../../util/StrUtil';
import IChannelDB from '../../db/IChannelDB';
import IDropLogFileDB from '../../db/IDropLogFileDB';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB';
import IReserveDB from '../../db/IReserveDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IRecordingEvent from '../../event/IRecordingEvent';
import IReserveEvent from '../../event/IReserveEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import EitPresentParser, { EitPresentEvent } from './EitPresentParser';
import {
    classifyStartFailure,
    decideRecordingRetry,
    getFirstDataWaitTimeoutMs,
    RecordingRetryReason,
    resolveRecordingRetryConfig,
} from './RecordingRetryPolicy';
import { decideRecordingStart, isProgramStartBoundary, resolveRecordingStartGateConfig } from './RecordingStartGate';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import INotificationDispatcher from '../../notification/INotificationDispatcher';
import IDropCheckerModel from './IDropCheckerModel';
import IRecorderModel, { RecordingResumeInfo } from './IRecorderModel';
import IRecordingStreamCreator from './IRecordingStreamCreator';
import IRecordingUtilModel, { RecFilePathInfo } from './IRecordingUtilModel';
import LongTimer from '../../../util/LongTimer';
import { toMirakurunPriority } from '../reservation/ReservationPriorityUtil';
import RecordingStartBuffer from './RecordingStartBuffer';
import { RecordingTimingConfig, resolveRecordingTimingConfig } from './RecordingTimingConfig';
import { decideRecordingEnd } from './RecordingBoundary';
import IEitPresentStore from '../../service/stream/util/IEitPresentStore';
import IReservationManageModel from '../reservation/IReservationManageModel';
import { extendUndefinedDurationEndAt, resolveProgramEndTimes } from '../../../util/ProgramDuration';
import IIPCServer from '../../ipc/IIPCServer';
import IRecordingSessionDB from '../../db/IRecordingSessionDB';
import RecordingSession from '../../../db/entities/RecordingSession';
import { RecordingSessionState, transitionRecordingSession } from './RecordingSessionState';
import RecordingSink from './RecordingSink';
import { countRecordingGaps } from './RecordingGapUtil';
import RecordingUpstreamSession from './RecordingUpstreamSession';
import { usesManagedEnd } from './RecordingStreamEndPolicy';
import telemetry from '../../observability/Telemetry';
import RecordingSessionTracker from './RecordingSessionTracker';
import RecordingResumeCoordinator from './RecordingResumeCoordinator';

/**
 * Recorder
 */
@injectable()
class RecorderModel implements IRecorderModel {
    private log: ILogger;
    private config: IConfigFile;
    private programDB: IProgramDB;
    private channelDB: IChannelDB;
    private reserveDB: IReserveDB;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private videoFileDB: IVideoFileDB;
    private dropLogFileDB: IDropLogFileDB;
    private streamCreator: IRecordingStreamCreator;
    private dropChecker: IDropCheckerModel;
    private recordingUtil: IRecordingUtilModel;
    private recordingEvent: IRecordingEvent;
    private mirakurunClientModel: IMirakurunClientModel;
    private notification: INotificationDispatcher;
    private reserveEvent: IReserveEvent;
    private eitPresentStore: IEitPresentStore;
    private ipc: IIPCServer;
    private recordingSessionDB: IRecordingSessionDB;

    private reserve!: Reserve;
    private recordedId: apid.RecordedId | null = null;
    private videoFileId: apid.VideoFileId | null = null;
    private videoFileFullPath: string | null = null;
    // 数週間先の予約でも setTimeout の 32bit 上限で即発火しないよう LongTimer を使う
    private timer = new LongTimer();
    // 録画準備失敗後の再試行待ちタイマー。準備中のキャンセルと区別する
    private prepRetryTimerId: NodeJS.Timeout | null = null;
    // 番組開始待ちの起点 (ms)。チューナー異常のリトライ回数とは別に数える
    private waitingForEventSince: number | null = null;
    // チューナー異常など、待っても直らない可能性がある失敗の回数
    private errorRetryCount: number = 0;
    private stream: http.IncomingMessage | null = null;
    private passThroughStreamForWrite: stream.PassThrough | null = null;
    private recFile: fs.WriteStream | null = null;
    private recordingSink: RecordingSink | null = null;
    private upstreamSession: RecordingUpstreamSession | null = null;
    private isFinishing: boolean = false;
    private isStreamReleased: boolean = false;
    private isStopPrepRec: boolean = false;
    private isNeedDeleteReservation: boolean = true;
    private isPrepRecording: boolean = false;
    private isPrepRecordInFlight: boolean = false;
    // 世代が変わった準備チェーンは、遅れて完了しても再試行や失敗通知を行わない
    private prepGeneration: number = 0;
    private isRecording: boolean = false;
    private isPlanToDelete: boolean = false;
    private eventEmitter = new events.EventEmitter();

    private dropLogFileId: apid.DropLogFileId | null = null;

    private abortController: AbortController | null = null;
    private boundaryEndTimerId: NodeJS.Timeout | null = null;
    private boundaryEndReason: string | null = null;
    private boundaryTargetSeen: boolean = false;
    private monitoredEitStreams = new WeakSet<http.IncomingMessage>();
    private monitoredBoundaryStreams = new WeakSet<http.IncomingMessage>();
    private sessionTracker: RecordingSessionTracker;
    private telemetryGapStartedAt: number | null = null;
    private telemetryStartDelayRecorded = false;
    private lastAttemptHadData: boolean = false;
    private resumeInfo: RecordingResumeInfo | null = null;
    private resumeFilePath: string | null = null;
    private resumeFileOffset: number = 0;
    private reservationManage?: IReservationManageModel;
    private plannedEndExtensionInFlight = false;

    // イベントリレータイマー
    private eventRelayTimer = new LongTimer();
    // イベントリレーの確認を一度でも仕掛けたか (発火済みでも true のまま)
    private isEventRelayTimerSet = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordingStreamCreator')
        streamCreator: IRecordingStreamCreator,
        @inject('IDropCheckerModel') dropChecker: IDropCheckerModel,
        @inject('IRecordingUtilModel') recordingUtil: IRecordingUtilModel,
        @inject('IRecordingEvent') recordingEvent: IRecordingEvent,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('INotificationDispatcher') notification: INotificationDispatcher,
        @inject('IReserveEvent') reserveEvent: IReserveEvent,
        @inject('IEitPresentStore') eitPresentStore: IEitPresentStore,
        @inject('IIPCServer') ipc: IIPCServer,
        @inject('IRecordingSessionDB') recordingSessionDB: IRecordingSessionDB,
        @inject('IReservationManageModel') @optional() reservationManage?: IReservationManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.programDB = programDB;
        this.channelDB = channelDB;
        this.reserveDB = reserveDB;
        this.recordedDB = recordedDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.videoFileDB = videoFileDB;
        this.dropLogFileDB = dropLogFileDB;
        this.streamCreator = streamCreator;
        this.dropChecker = dropChecker;
        this.recordingUtil = recordingUtil;
        this.recordingEvent = recordingEvent;
        this.mirakurunClientModel = mirakurunClientModel;
        this.notification = notification;
        this.reserveEvent = reserveEvent;
        this.eitPresentStore = eitPresentStore;
        this.ipc = ipc;
        this.recordingSessionDB = recordingSessionDB;
        this.sessionTracker = new RecordingSessionTracker(recordingSessionDB, this.log);
        this.reservationManage = reservationManage;
    }

    private async persistRecordingSession(values: Partial<RecordingSession>): Promise<void> {
        await this.sessionTracker.persist(values);
    }

    private async transitionSession(event: Parameters<typeof transitionRecordingSession>[1]): Promise<void> {
        await this.sessionTracker.transition(event);
    }

    private async beginRecordingSession(): Promise<void> {
        await this.sessionTracker.beginSession(this.reserve);
        this.telemetryStartDelayRecorded = false;
    }

    private async beginRecordingAttempt(): Promise<void> {
        const priority = toMirakurunPriority(
            this.reserve.isConflict ? this.config.conflictPriority : this.config.recPriority,
            this.reserve.priority,
            this.config.streamingPriority,
            this.reserve.isConflict,
            this.config.recPriority,
        );
        await this.sessionTracker.beginAttempt(priority);
    }

    private observeRecordingAttempt(observedStream: http.IncomingMessage): void {
        const attempt = this.sessionTracker.currentAttempt;
        if (attempt === null) return;
        observedStream.on('data', (chunk: Buffer) => {
            if (this.sessionTracker.currentAttempt !== attempt) return;
            attempt.bytesReceived = (attempt.bytesReceived ?? 0) + chunk.length;
            if (attempt.firstDataAt === null) {
                attempt.firstDataAt = Date.now();
                void this.recordingSessionDB
                    .updateAttempt(attempt.id, { firstDataAt: attempt.firstDataAt })
                    .catch(err => {
                        this.log.system.warn(`recording attempt update failed: ${attempt.id}`);
                        this.log.system.warn(err);
                    });
            }
        });
    }

    private async finishRecordingAttempt(
        reason: string | null,
        error?: Error,
        includeInResult: boolean = true,
    ): Promise<void> {
        await this.sessionTracker.finishAttempt(reason, error, includeInResult);
    }

    /**
     * EIT[p/f] 追従中 (前番組の延長などで番組開始を待っている) 状態を更新し、画面へ通知する
     * @param isFollowingSchedule: boolean 追従中か
     */
    private async setFollowingSchedule(isFollowingSchedule: boolean): Promise<void> {
        if (this.reserve.isFollowingSchedule === isFollowingSchedule) {
            return;
        }

        this.reserve.isFollowingSchedule = isFollowingSchedule;
        try {
            await this.reserveDB.updateFollowingSchedule(this.reserve.id, isFollowingSchedule);
            this.reserveEvent.emitUpdated({ update: [this.reserve], isSuppressLog: true });
        } catch (err: any) {
            this.log.system.error(`update following schedule state error: ${this.reserve.id}`);
            this.log.system.error(err);
        }
    }

    /**
     * タイマーをセットする
     * @param reserve: Reserve 予約情報
     * @param isSuppressLog: boolean ログ出力を抑えるか
     * @return boolean セットに成功したら true を返す
     */
    public setTimer(reserve: Reserve, isSuppressLog: boolean): boolean {
        const generation = ++this.prepGeneration;
        this.reserve = reserve;

        if (this.prepRetryTimerId !== null) {
            clearTimeout(this.prepRetryTimerId);
            this.prepRetryTimerId = null;
        }
        this.isStopPrepRec = false;
        this.errorRetryCount = 0;
        this.waitingForEventSince = null;
        this.boundaryEndReason = null;
        if (this.resumeInfo === null) {
            this.sessionTracker.session = null;
            this.sessionTracker.currentAttempt = null;
            this.sessionTracker.attemptCount = 0;
        }
        if (this.resumeInfo === null) this.sessionTracker.closeReasons = [];

        // 除外, 重複しているものはタイマーをセットしない
        if (this.reserve.isSkip === true || this.reserve.isOverlap === true) {
            return false;
        }

        const now = new Date().getTime();
        const recoveryDeadline = this.reserve.endAt + this.getTimingConfig().endMarginMs;
        if (now >= (this.resumeInfo === null ? this.reserve.endAt : recoveryDeadline)) {
            return false;
        }

        // 待機時間を計算
        let time = this.reserve.startAt - now - this.getTimingConfig().prepMs;
        if (time < 0) {
            time = 0;
        }

        // タイマーをセット
        if (isSuppressLog === false) {
            this.log.system.info(`set timer: ${this.reserve.id}, ${time}`);
        }
        this.timer.set(async () => {
            if (generation !== this.prepGeneration) {
                return;
            }
            try {
                this.prepRecord();
            } catch (err: any) {
                this.log.system.error(`failed prep record: ${this.reserve.id}`);
            }
        }, time);

        return true;
    }

    /**
     * 異常終了した録画の既存ファイルへ追記するタイマーをセットする
     * @param reserve: Reserve 予約情報
     * @param isSuppressLog: boolean ログ出力を抑えるか
     * @param info: RecordingResumeInfo 復帰対象
     * @return boolean セットに成功したら true
     */
    public setResumeTimer(reserve: Reserve, isSuppressLog: boolean, info: RecordingResumeInfo): boolean {
        const prepared = RecordingResumeCoordinator.prepare(info, this.config);
        if (prepared === null) return false;

        this.resumeInfo = info;
        this.sessionTracker.session = info.session;
        this.sessionTracker.telemetrySessionId = info.session.id;
        this.telemetryStartDelayRecorded = true;
        telemetry.recordingSessionStarted(info.session.id);
        this.recordedId = info.recorded.id;
        this.videoFileId = info.videoFile.id;
        this.dropLogFileId = info.recorded.dropLogFileId;
        this.resumeFilePath = prepared.filePath;
        this.sessionTracker.attemptCount = prepared.attemptCount;
        this.resumeFileOffset = prepared.fileOffset;
        this.sessionTracker.gapCount = prepared.gapCount;
        this.sessionTracker.closeReasons = prepared.closeReasons;
        return this.setTimer(reserve, isSuppressLog);
    }

    /**
     * 録画準備
     */
    private async prepRecord(retry: number = 0): Promise<void> {
        const generation = this.prepGeneration;
        let prepStream: http.IncomingMessage | null = null;

        // 番組開始待ちの起点。予定開始時刻とこの時点の遅い方から数える
        // (EPG 更新で予約時刻が動いた場合に待ち直せるようにする)
        if (this.waitingForEventSince === null) {
            this.waitingForEventSince = Math.max(this.reserve.startAt, new Date().getTime());
        }

        if (this.isStopPrepRec === true) {
            this.isPlanToDelete = false;
            this.emitCancelEvent();

            return;
        }

        this.log.system.info(`preprec: ${this.reserve.id}`);

        if (retry === 0 && this.sessionTracker.session === null) await this.beginRecordingSession();

        this.isPrepRecording = true;
        this.isPrepRecordInFlight = true;
        this.isRecording = false;
        this.isPlanToDelete = false;

        if (retry === 0) {
            // 録画準備開始通知
            this.recordingEvent.emitStartPrepRecording(this.reserve);
        }

        // 番組ストリームを取得する
        try {
            // 番組開始時刻が変更されたことに伴い番組間に重なりが生じ、当該番組が削除されている
            // NOTE: mirakurunの不具合に対処
            if (this.reserve.programId) {
                const program = await this.programDB.findId(this.reserve.programId);
                if (this.isObsoletePrepChain(generation, prepStream) === true) {
                    return;
                }
                if (program === null) {
                    this.log.system.warn(
                        `the program data does not found in database. retry later, (reerveId: ${this.reserve.id}, programId: ${this.reserve.programId})`,
                    );
                    throw new Error(RecorderModel.WAITING_FOR_EVENT_ERROR);
                }
            }

            this.abortController = new AbortController();
            await this.beginRecordingAttempt();
            this.stream = await this.streamCreator.create(this.reserve, this.abortController.signal);
            this.observeRecordingAttempt(this.stream);
            prepStream = this.stream;
            if (this.isObsoletePrepChain(generation, prepStream) === true) {
                return;
            }

            // 録画準備のキャンセル or ストリーム取得中に予約が削除されていないかチェック
            if ((await this.reserveDB.findId(this.reserve.id)) === null) {
                if (this.isObsoletePrepChain(generation, prepStream) === true) {
                    return;
                }
                this.log.system.error(`canceled preprec: ${this.reserve.id}`);
                this.destroyStream();
                this.emitCancelEvent();
            } else {
                await this.doRecord();
                if (this.isObsoletePrepChain(generation, prepStream) === true) {
                    return;
                }
            }
        } catch (err: any) {
            if (this.isObsoletePrepChain(generation, prepStream) === true) {
                return;
            }
            await this.finishRecordingAttempt('error', err instanceof Error ? err : undefined, false);
            if ((this.isStopPrepRec as any) === true) {
                this.destroyStream();
                this.emitCancelEvent();
                return;
            }

            // 「番組がまだ始まっていない」のか「チューナー等の異常」なのかで待ち方を分ける。
            // 前者は前番組の延長 (放送時刻未定) 中に起きる正常な状態なので長く待つ
            const reason: RecordingRetryReason =
                err?.message === RecorderModel.WAITING_FOR_EVENT_ERROR ? 'waitingForEvent' : 'error';
            const retryConfig = resolveRecordingRetryConfig(this.config.recording);
            const waitedMs = new Date().getTime() - (this.waitingForEventSince ?? new Date().getTime());
            const decision = decideRecordingRetry({
                reason,
                errorRetryCount: this.errorRetryCount,
                waitedMs,
                config: retryConfig,
                backendUnavailable: err?.status === 503 || err?.statusCode === 503 || err?.response?.status === 503,
                reserveStartAt: this.reserve.startAt,
                now: Date.now(),
                marginOverlap:
                    typeof this.reserve.conflictInfo === 'string' &&
                    this.reserve.conflictInfo.includes('"MARGIN_OVERLAP"'),
            });

            if (reason === 'waitingForEvent') {
                // 前番組の延長などで EIT[p/f] がまだ present になっていない状態。
                // 画面に「追従中」と出せるように予約へ記録する
                await this.setFollowingSchedule(true);
                if (this.isObsoletePrepChain(generation, prepStream) === true) {
                    return;
                }
                this.log.system.info(
                    `waiting for the program to start: reserveId: ${this.reserve.id},` +
                        ` programId: ${this.reserve.programId},` +
                        ` scheduled start: ${formatLogTime(this.reserve.startAt)},` +
                        ` scheduled end: ${formatLogTime(this.reserve.endAt)},` +
                        ` waited: ${Math.floor(waitedMs / 1000)}s / ${Math.floor(retryConfig.startWaitLimitMs / 1000)}s`,
                );
            } else {
                this.errorRetryCount++;
                if (this.recordedId === null) telemetry.tunerOpenFailure(String(this.reserve.channelType));
                // 何回目の失敗か・上限・次回がいつかを 1 行で残す。
                // これが無いと同じエラーが並ぶだけで、粘っている最中なのか
                // もう諦めたのかがログから判断できない
                const errorRetryLimit = retryConfig.errorFastRetryCount + retryConfig.errorRetryCount;
                this.log.system.error(
                    `preprec failed: reserveId: ${this.reserve.id}, attempt: ${this.errorRetryCount}/${errorRetryLimit},` +
                        ` next: ${decision.retry === true ? `${Math.floor(decision.delayMs / 1000)}s later` : 'give up'},` +
                        ` error: ${err?.message ?? err}`,
                );
                this.log.system.error(err);
            }

            if (decision.retry === true) {
                this.prepRetryTimerId = setTimeout(() => {
                    if (generation !== this.prepGeneration) {
                        return;
                    }
                    this.prepRetryTimerId = null;
                    this.prepRecord(retry + 1);
                }, decision.delayMs);
            } else {
                this.isPrepRecording = false;
                if (reason === 'waitingForEvent') {
                    this.log.system.error(
                        `the program did not start within the wait limit: reserveId: ${this.reserve.id}`,
                    );
                } else {
                    this.log.system.error(
                        `gave up preparing recording: reserveId: ${this.reserve.id},` +
                            ` programId: ${this.reserve.programId}, channelId: ${this.reserve.channelId},` +
                            ` attempts: ${this.errorRetryCount}, last error: ${err?.message ?? err}`,
                    );
                }
                // 待機を打ち切ったので追従中の表示も解除する
                await this.setFollowingSchedule(false);
                this.sessionTracker.closeReasons = ['error'];
                if (this.recordedId !== null) {
                    this.sessionTracker.closeReasons = ['transport-lost'];
                    this.boundaryEndReason = 'transport-lost';
                    await this.recEnd(false);
                    this.recordingEvent.emitRecordingFailed(
                        this.reserve,
                        await this.recordedDB.findId(this.recordedId),
                    );
                    return;
                }
                await this.transitionSession('fail');
                await this.persistRecordingSession({
                    state: RecordingSessionState.FINISHED,
                    actualEndAt: Date.now(),
                    endReason: 'error',
                    resultStatus: 'failed',
                });
                this.closeTelemetrySession('failed', 'error');
                this.streamCreator.release(this.reserve.id);
                // 録画準備失敗を通知
                this.recordingEvent.emitPrepRecordingFailed(this.reserve);
            }
        } finally {
            if (generation === this.prepGeneration) {
                this.abortController = null;
                this.isPrepRecordInFlight = false;
            }
        }
    }

    /**
     * 録画準備キャンセル完了時に発行するイベント
     */
    private emitCancelEvent(): void {
        ++this.prepGeneration;
        this.isStopPrepRec = false;
        this.isPrepRecording = false;
        this.isRecording = false;
        this.streamCreator.release(this.reserve.id);

        // 追従中の表示を残さない
        this.setFollowingSchedule(false).catch(err => {
            this.log.system.error(err);
        });

        this.eventEmitter.emit(RecorderModel.CANCEL_EVENT);
    }

    /**
     * strem 破棄
     * @param needesUnpip: boolean
     */
    private destroyStream(
        needesUnpip: boolean = true,
        reason: Exclude<IRecordingStreamCreator.CloseReason, null> = 'teardown',
    ): void {
        if (this.boundaryEndTimerId !== null) {
            clearTimeout(this.boundaryEndTimerId);
            this.boundaryEndTimerId = null;
        }
        // stop stream
        if (this.stream !== null) {
            try {
                if (needesUnpip === true) {
                    this.stream.unpipe();
                }
                this.streamCreator.closeStream(this.stream, reason);
                this.stream.removeAllListeners('data');
                this.stream = null;
            } catch (err: any) {
                this.log.system.error(`destroy stream error: ${this.reserve.id}`);
                this.log.system.error(err);
            }
        }

        if (this.passThroughStreamForWrite !== null) {
            try {
                if (needesUnpip === true) {
                    this.passThroughStreamForWrite.unpipe();
                }
                this.passThroughStreamForWrite.destroy();
                this.passThroughStreamForWrite = null;
            } catch (err: any) {
                this.log.system.error(`destroy pass through stream error: ${this.reserve.id}`);
                this.log.system.error(err);
            }
        }

        // stop save file
        if (this.recFile !== null) {
            try {
                this.recFile.removeAllListeners('error');
                this.recFile.end();
            } catch (err: any) {
                this.log.system.error(`end recFile error: ${this.reserve.id}`);
                this.log.system.error(err);
            }
        }

        // stop drop check
        if (this.dropLogFileId !== null) {
            this.dropChecker.stop().catch(err => {
                this.log.system.error(`dropChecker stop error: ${this.reserve.id}`);
                this.log.system.error(err);
            });
        }
    }

    /**
     * 世代が無効になった準備チェーンのストリームだけを破棄する
     * @param prepStream: http.IncomingMessage | null 無効なチェーンが取得したストリーム
     */
    private destroyObsoletePrepStream(prepStream: http.IncomingMessage | null): void {
        if (prepStream === null) {
            return;
        }

        try {
            this.streamCreator.closeStream(prepStream, 'obsolete');
            prepStream.removeAllListeners('data');
            if (this.stream === prepStream) {
                this.stream = null;
            }
        } catch (err: any) {
            this.log.system.error(`destroy obsolete stream error: ${this.reserve.id}`);
            this.log.system.error(err);
        }
    }

    /**
     * 予約の再スケジュールやキャンセルで世代が変わった準備チェーンを終了させる。
     *
     * 世代が変わった後の遅れた完了で再試行タイマーを張り直すと、新しいスケジュールと
     * 並走して同じ予約の録画準備が二重に走るため、掴んだストリームだけ片付けて黙って終える。
     * キャンセル待ちが居る場合はここで完了を通知する
     * @param generation: number チェーン開始時の世代
     * @param prepStream: http.IncomingMessage | null チェーンが取得したストリーム
     * @return boolean 世代が変わっていて終了すべき場合は true
     */
    private isObsoletePrepChain(generation: number, prepStream: http.IncomingMessage | null): boolean {
        if (generation === this.prepGeneration) {
            return false;
        }

        this.destroyObsoletePrepStream(prepStream);
        if (this.isStopPrepRec === true) {
            this.emitCancelEvent();
        }

        return true;
    }

    /**
     * 録画処理
     */
    private async doRecord(): Promise<void> {
        if (this.stream === null) {
            return;
        }

        // 録画キャンセル
        if (this.isStopPrepRec === true) {
            this.log.system.error(`cancel recording: ${this.reserve.id}`);
            this.destroyStream();
            this.emitCancelEvent();

            return;
        }

        // 再開録画では既存 Recorded に対して予約番組の開始待ちを行わない。
        // 通常録画は前番組の延長対策として開始境界を待つ。
        let waitingBuffer: Buffer[] = [];
        if (this.resumeInfo === null) {
            try {
                await this.transitionSession('wait-boundary');
                waitingBuffer = await this.waitForProgramStart();
            } catch (err: any) {
                this.destroyStream();
                throw err;
            }
        }

        // 録画開始待ちの間にキャンセルされていないか
        if ((this.isStopPrepRec as boolean) === true) {
            this.log.system.error(`cancel recording: ${this.reserve.id}`);
            this.destroyStream();
            this.emitCancelEvent();

            return;
        }

        this.isPrepRecording = false;
        this.isRecording = true;
        if (this.resumeInfo === null) {
            await this.transitionSession('first-data');
            await this.persistRecordingSession({ recordedId: this.recordedId, actualStartAt: Date.now() });
        } else {
            await this.persistRecordingSession({ state: RecordingSessionState.RECORDING });
        }

        // 番組が始まったので追従中の表示を解除する
        await this.setFollowingSchedule(false);

        // 録画開始内部イベント発行
        // 時刻指定予約で録画準備中に endAt を変えようとした場合にこのイベントを受信してから変える
        this.eventEmitter.emit(RecorderModel.START_RECORDING_EVENT);

        // 保存先を取得
        const recPath =
            this.resumeInfo === null
                ? await this.recordingUtil.getRecPath(this.reserve, true)
                : {
                      parendDir: this.config.recorded.find(
                          dir => dir.name === this.resumeInfo!.videoFile.parentDirectoryName,
                      ) ?? {
                          name: 'tmp',
                          path: this.config.recordedTmp ?? path.dirname(this.resumeFilePath!),
                      },
                      subDir: path.dirname(this.resumeInfo.videoFile.filePath),
                      fileName: path.basename(this.resumeInfo.videoFile.filePath),
                      fullPath: this.resumeFilePath!,
                  };
        this.videoFileFullPath = recPath.fullPath;

        this.log.system.info(`recording: ${this.reserve.id} ${recPath.fullPath}`);

        // save stream
        this.recFile = fs.createWriteStream(recPath.fullPath, { flags: 'a' });
        this.recFile.once('error', async err => {
            // 書き込みエラー発生
            this.log.system.error(`recFile error reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`);
            this.log.system.error(err);
            if (this.stream === null) {
                this.cancel(false);
            } else {
                if (this.stream !== null) this.streamCreator.markClose(this.stream, 'write-error');
                await this.recFailed(err).catch(err => {
                    this.log.system.fatal(
                        `Unexpected recFailed error: reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`,
                    );
                    this.log.system.fatal(err);
                });
            }
        });

        this.passThroughStreamForWrite = new stream.PassThrough();
        this.recordingSink = new RecordingSink(this.recFile, this.passThroughStreamForWrite);

        // drop checker
        if (this.config.isEnabledDropCheck === true) {
            let dropFilePath: string | null = null;
            try {
                await this.dropChecker.start(this.config.dropLog, recPath.fullPath, this.passThroughStreamForWrite);
                dropFilePath = this.dropChecker.getFilePath();
            } catch (err: any) {
                this.log.system.error(`drop check error: ${recPath.fullPath}`);
                this.log.system.error(err);
                dropFilePath = null;
            }

            // drop 情報を DB へ反映
            if (dropFilePath !== null && this.dropLogFileId === null) {
                const dropLogFile = new DropLogFile();
                dropLogFile.errorCnt = 0;
                dropLogFile.dropCnt = 0;
                dropLogFile.scramblingCnt = 0;
                dropLogFile.filePath = path.basename(dropFilePath);
                this.log.system.info(`add drop log file: ${dropFilePath}`);
                try {
                    this.dropLogFileId = await this.dropLogFileDB.insertOnce(dropLogFile);
                } catch (err: any) {
                    this.dropLogFileId = null;
                    this.log.system.error(`add drop log file error: ${dropFilePath}`);
                    this.log.system.error(err);
                }
            }
        }

        this.setupProgramBoundaryMonitor(waitingBuffer);
        this.setupEitPresentMonitor(waitingBuffer);
        if (this.sessionTracker.currentAttempt !== null) {
            this.sessionTracker.currentAttempt.fileOffsetStart = this.resumeInfo === null ? 0 : this.resumeFileOffset;
            void this.recordingSessionDB
                .updateAttempt(this.sessionTracker.currentAttempt.id, {
                    fileOffsetStart: this.sessionTracker.currentAttempt.fileOffsetStart,
                })
                .catch(err => {
                    this.log.system.warn(
                        `recording attempt offset update failed: ${this.sessionTracker.currentAttempt?.id ?? 'unknown'}`,
                    );
                    this.log.system.warn(err);
                });
        }
        const recordingStream = this.stream;
        const sink = this.recordingSink;
        if (recordingStream === null || sink === null) {
            throw new Error('StreamIsNull');
        }
        let resolveStarted!: () => void;
        let rejectStarted!: (error: Error) => void;
        const started = new Promise<void>((resolve, reject) => {
            resolveStarted = resolve;
            rejectStarted = reject;
        });
        let hasStartedRecording = false;
        const session = new RecordingUpstreamSession({
            creator: this.streamCreator,
            reserve: () => this.reserve,
            sink,
            deadline: () => this.reserve.endAt + this.getTimingConfig().endMarginMs,
            managedEnd: usesManagedEnd(this.reserve.programId, this.config.recording?.programStreamMode ?? 'service'),
            reconnectEnabled: this.config.recording?.reconnectEnabled !== false,
            preserveRawBytes: this.config.recording?.reconnectEnabled === false,
            isCurrent: (): boolean => this.upstreamSession === session && !this.isFinishing,
            boundaryDecided: () => this.boundaryEndReason !== null,
            onAttemptStart: async offset => {
                await this.beginRecordingAttempt();
                if (this.sessionTracker.currentAttempt !== null) {
                    this.sessionTracker.currentAttempt.fileOffsetStart =
                        offset + (this.resumeInfo === null ? 0 : this.resumeFileOffset);
                    await this.recordingSessionDB
                        .updateAttempt(this.sessionTracker.currentAttempt.id, {
                            fileOffsetStart: this.sessionTracker.currentAttempt.fileOffsetStart,
                        })
                        .catch(err => this.log.system.warn(err));
                }
            },
            onAttemptEnd: async (reason, err) => {
                this.lastAttemptHadData =
                    this.sessionTracker.currentAttempt !== null &&
                    this.sessionTracker.currentAttempt.firstDataAt !== null;
                if (this.sessionTracker.currentAttempt !== null) {
                    const baseOffset = this.resumeInfo === null ? 0 : this.resumeFileOffset;
                    this.sessionTracker.currentAttempt.bytesReceived =
                        sink.getBytesWritten() -
                        ((this.sessionTracker.currentAttempt.fileOffsetStart ?? baseOffset) - baseOffset);
                    this.sessionTracker.currentAttempt.fileOffsetEnd = baseOffset + sink.getBytesWritten();
                }
                const recordedReason =
                    reason ??
                    (err as NodeJS.ErrnoException | undefined)?.code ??
                    (err ? 'transport-lost' : 'upstream-eof');
                if (recordedReason === 'process-shutdown') {
                    await sink.finish().catch(finishError => {
                        this.log.system.error(`recording sink finish failed during shutdown: ${this.reserve.id}`);
                        this.log.system.error(finishError);
                    });
                }
                await this.finishRecordingAttempt(recordedReason, err, recordedReason !== 'process-shutdown');
            },
            onChunk: () => {},
            onFirstData: async source => {
                clearTimeout(firstDataTimeout);
                if (this.telemetryStartDelayRecorded === false) {
                    telemetry.recordingStartDelay(Math.max(0, Date.now() - this.reserve.startAt));
                    this.telemetryStartDelayRecorded = true;
                }
                const attempt = this.sessionTracker.currentAttempt;
                if (attempt !== null && attempt.firstDataAt === null) {
                    attempt.firstDataAt = Date.now();
                    await this.recordingSessionDB
                        .updateAttempt(attempt.id, { firstDataAt: attempt.firstDataAt })
                        .catch(err => {
                            this.log.system.warn(`recording attempt first-data update failed: ${attempt.id}`);
                            this.log.system.warn(err);
                        });
                }
                this.stream = source;
                this.attachProgramBoundaryMonitor(source, []);
                this.attachEitPresentMonitor(source, []);
                if (this.recordedId === null) {
                    const recorded = await this.addRecorded(recPath);
                    this.recordingEvent.emitStartRecording(this.reserve, recorded);
                    if (this.reserve.programId !== null) this.setEventRelayTimer(this.reserve);
                    hasStartedRecording = true;
                    resolveStarted();
                } else if (this.resumeInfo !== null && hasStartedRecording === false) {
                    this.recordingEvent.emitStartRecording(this.reserve, this.resumeInfo.recorded);
                    if (this.reserve.programId !== null) this.setEventRelayTimer(this.reserve);
                    hasStartedRecording = true;
                    resolveStarted();
                }
            },
            onStartError: err => {
                this.isRecording = false;
                this.isPrepRecording = false;
                rejectStarted(err);
                session.stop();
            },
            onReconnectState: reconnecting => {
                if (reconnecting) this.stream = null;
                void this.transitionSession(reconnecting ? 'reconnect' : 'reconnected');
            },
            onGapStart: reason => {
                if (this.lastAttemptHadData === true) {
                    this.sessionTracker.gapCount++;
                    this.telemetryGapStartedAt = Date.now();
                }
                this.log.system.warn(`recording upstream gap: reserveId: ${this.reserve.id}, reason: ${reason}`);
            },
            onGapEnd: () => {
                if (this.telemetryGapStartedAt === null) return;
                telemetry.gap(Date.now() - this.telemetryGapStartedAt);
                this.telemetryGapStartedAt = null;
            },
            onWriteError: err => {
                void this.recFailed(err);
            },
            onReconnectError: (err, attempt) => {
                this.log.system.warn(
                    `recording reconnect failed: reserveId: ${this.reserve.id}, attempt: ${attempt}, error: ${err.message}`,
                );
            },
        });
        this.upstreamSession = session;
        this.stream = recordingStream;
        const firstDataTimeout = setTimeout(() => {
            if (this.recordedId !== null || this.isFinishing) return;
            session.stop();
            rejectStarted(
                new Error(
                    classifyStartFailure('no-data-after-pipe', this.isLegacyProgramStream()) === 'error'
                        ? RecorderModel.TRANSPORT_ERROR
                        : RecorderModel.WAITING_FOR_EVENT_ERROR,
                ),
            );
        }, resolveRecordingRetryConfig(this.config.recording).firstDataTimeoutMs);
        const sessionTask = session
            .run(recordingStream, waitingBuffer)
            .then(async decision => {
                if (this.isFinishing || hasStartedRecording === false) return;
                if (decision === 'failed') {
                    await this.recFailed(new Error(RecorderModel.TRANSPORT_ERROR), 'transport-lost');
                    return;
                }
                if (decision === 'boundary') this.boundaryEndReason = 'boundary';
                else if (decision === 'canceled') this.boundaryEndReason = 'canceled';
                else if (decision === 'scheduled-end') this.boundaryEndReason = 'scheduled-end';
                else if (decision === 'reconnect') this.boundaryEndReason = 'transport-lost';
                await this.recEnd();
            })
            .catch(err => {
                this.log.system.error(err);
                void this.recFailed(err instanceof Error ? err : new Error(String(err)));
            });
        void sessionTask;
        try {
            await started;
        } catch (err) {
            this.destroyStream();
            await FileUtil.unlink(recPath.fullPath).catch(() => {});
            throw err;
        } finally {
            clearTimeout(firstDataTimeout);
        }
    }

    /** 録画中の全TSからEIT[p/f]を読み、Operator/Service双方のストアへ渡す */
    private setupEitPresentMonitor(initialChunks: Buffer[] = []): void {
        if (this.stream === null) return;
        this.attachEitPresentMonitor(this.stream, initialChunks);
    }

    private attachEitPresentMonitor(source: http.IncomingMessage, initialChunks: Buffer[] = []): void {
        if (this.monitoredEitStreams.has(source)) return;
        this.monitoredEitStreams.add(source);
        const parser = new EitPresentParser();
        const serviceId = this.reserve.channelId % 100000;
        const consume = (chunk: Buffer): void => {
            for (const event of parser.write(chunk)) {
                if (event.serviceId !== serviceId) continue;
                const record = {
                    eventId: event.eventId,
                    startAt: event.startAt,
                    durationSec: event.durationSec,
                    receivedAt: new Date().getTime(),
                    isFollowing: event.isFollowing === true,
                };
                this.eitPresentStore.update(this.reserve.channelId, record);
                this.ipc.notifyEitPresent(this.reserve.channelId, record);
            }
        };
        for (const chunk of initialChunks) consume(chunk);
        source.on('data', consume);
    }

    /**
     * 予約した番組が実際に始まる (EIT[p/f] following の start_time 到達、または
     * present の更新) まで待つ。
     *
     * 時刻指定予約は Mirakurun のチャンネルストリームを使うため、予定時刻になった瞬間から
     * データが流れる。前番組が「放送時間未定」で延長している間はまだ前番組なので、
     * そのまま録り始めると前番組が録画ファイルとして残ってしまう。
     * ここで EIT[p/f] を読み、目的の番組になるまで末尾 8 MiB だけを保持して待つ。
     *
     * - データ自体が来ない場合は従来どおり `WaitingForEventStart` で再試行へ回す
     * - EIT[p/f] を読めない、または前番組が放送時間未定のまま上限を過ぎた場合は
     *   録り逃さないよう開始する (安全側)
     * - 予約終了時刻を過ぎても始まらない場合は再試行へ回す
     * @return Promise<Buffer[]> 開始判定直前まで保持した TS (受信順)
     */
    private async waitForProgramStart(): Promise<Buffer[]> {
        const stream = this.stream;
        if (stream === null) {
            throw new Error('StreamIsNull');
        }

        const gateConfig = resolveRecordingStartGateConfig(this.config.recording);
        const retryConfig = resolveRecordingRetryConfig(this.config.recording);
        const timing = this.getTimingConfig();
        // Mirakurun の program id は networkId * 10^10 + serviceId * 10^5 + eventId、
        // channel id は networkId * 100000 + serviceId で作られている
        const eventId = this.reserve.programId === null ? null : this.reserve.programId % 100000;
        const serviceId = this.reserve.channelId % 100000;
        let isProgramBoundary = true;
        if (eventId === null) {
            const programs = await this.programDB.findSchedule({
                channelId: this.reserve.channelId,
                startAt: this.reserve.startAt - 2 * 60 * 1000,
                endAt: this.reserve.startAt + 2 * 60 * 1000,
                isHalfWidth: false,
            });
            isProgramBoundary = isProgramStartBoundary(programs, this.reserve.startAt);
        }

        return new Promise<Buffer[]>((resolve, reject) => {
            const parser = new EitPresentParser();
            const startBuffer = new RecordingStartBuffer();
            let present: EitPresentEvent | null = null;
            let following: EitPresentEvent | null = null;
            let hasData = false;
            let lastLoggedReason: string | null = null;
            let startedAt: number | null = null;
            let startGateTimerId: NodeJS.Timeout | null = null;
            let hardGateTimerId: NodeJS.Timeout | null = null;
            let startGateTimedOut: 'soft' | 'hard' | null = null;
            let settled = false;
            let firstEitLogged = false;

            // service stream は時刻指定・programId とも TS 未到着を transport 異常として短時間で検知する。
            // legacy program stream だけは Mirakurun が対象 event_id までデータを止めるため、
            // firstDataTimeoutMs を下限として予約終了時刻または開始待ち上限まで保持する。
            const firstDataTimeoutMs = getFirstDataWaitTimeoutMs({
                eventId,
                reserveEndAt: this.reserve.endAt,
                now: new Date().getTime(),
                config: retryConfig,
                serviceStream: eventId !== null && this.config.recording?.programStreamMode !== 'program',
            });
            const firstDataTimerId = setTimeout(() => {
                cleanup();
                reject(
                    new Error(
                        classifyStartFailure('no-first-ts', this.isLegacyProgramStream()) === 'error'
                            ? RecorderModel.TRANSPORT_ERROR
                            : RecorderModel.WAITING_FOR_EVENT_ERROR,
                    ),
                );
            }, firstDataTimeoutMs);

            const cleanup = (): void => {
                clearTimeout(firstDataTimerId);
                if (startGateTimerId !== null) {
                    clearTimeout(startGateTimerId);
                }
                if (hardGateTimerId !== null) {
                    clearTimeout(hardGateTimerId);
                }
                stream.removeListener('data', onData);
                stream.removeListener('close', onStreamClosed);
                stream.removeListener('end', onStreamClosed);
                stream.removeListener('error', onStreamClosed);
                // リスナーを外しただけでは流れ続けてデータを取りこぼすため、
                // 録画の書き込み (pipe) を始めるまで止めておく
                stream.pause();
            };

            const decideStart = (): void => {
                // setTimeout は指定より僅かに早く発火することがある。タイマー経由の判定が
                // 経過時間不足で空振りすると次のデータまで開始判定が動かないため、
                // タイマーが発火した後は必ず上限に達したものとして扱う
                const elapsedMs = startedAt === null ? 0 : new Date().getTime() - startedAt;
                const forcedElapsedMs =
                    startGateTimedOut === 'hard'
                        ? Math.max(elapsedMs, gateConfig.hardTimeoutMs)
                        : startGateTimedOut === 'soft'
                          ? Math.max(elapsedMs, gateConfig.timeoutMs)
                          : elapsedMs;
                const decision = decideRecordingStart({
                    eventId: eventId,
                    reserveStartAt: this.reserve.startAt,
                    present: present,
                    following: following,
                    elapsedMs: forcedElapsedMs,
                    currentAt: new Date().getTime(),
                    recordingStartMarginMs: timing.startMarginMs,
                    isProgramBoundary,
                    config: gateConfig,
                });

                if (decision.canStart === true) {
                    if (startGateTimedOut !== null) telemetry.eitFallback(startGateTimedOut);
                    this.log.system.info(
                        `program start detected: reserveId: ${this.reserve.id}, reason: ${decision.reason}`,
                    );
                    settled = true;
                    cleanup();
                    resolve(startBuffer.drain());

                    return;
                }

                // 待ちに入ったことは 1 度だけ出す (データ受信のたびに出さない)
                if (lastLoggedReason !== decision.reason) {
                    lastLoggedReason = decision.reason;
                    this.log.system.info(
                        `waiting for the reserved program to start on air: reserveId: ${this.reserve.id},` +
                            ` reason: ${decision.reason},` +
                            ` scheduled start: ${formatLogTime(this.reserve.startAt)},` +
                            ` reserved eventId: ${eventId === null ? 'unknown' : eventId},` +
                            ` on air eventId: ${present === null ? 'unknown' : present.eventId},` +
                            ` on air start: ${present?.startAt == null ? 'unknown' : formatLogTime(present.startAt)}`,
                    );
                    // 画面に「開始待ち」と出す
                    this.setFollowingSchedule(true).catch(err => {
                        this.log.system.error(err);
                    });
                }

                // 予約終了時刻を過ぎても始まらない場合は再試行へ回す (ストリームを掴んだままにしない)
                if (new Date().getTime() > this.reserve.endAt) {
                    cleanup();
                    reject(new Error(RecorderModel.WAITING_FOR_EVENT_ERROR));
                }
            };

            const onData = (chunk: Buffer): void => {
                if (settled === true) return;
                startBuffer.push(chunk);
                if (hasData === false) {
                    hasData = true;
                    clearTimeout(firstDataTimerId);
                    // ゲートの上限は「予約開始時刻 (開始マージン込み)」から数える。
                    // 張り付き (prepRecSec) を延ばしても soft / hard timeout が
                    // 予定開始より前に発火して前番組を録り始めないようにする
                    startedAt = Math.max(new Date().getTime(), this.reserve.startAt - timing.startMarginMs);
                    this.log.system.info(
                        `first TS received: reserveId: ${this.reserve.id}, bytes: ${chunk.length},` +
                            ` programId: ${this.reserve.programId ?? 'time-specified'}`,
                    );
                    if (eventId !== null && this.config.recording?.programStreamMode === 'program') {
                        this.log.system.info(
                            `program stream data detected by Mirakurun event filter: reserveId: ${this.reserve.id}`,
                        );
                        settled = true;
                        cleanup();
                        resolve(startBuffer.drain());
                        return;
                    }
                    if (gateConfig.enabled === true) {
                        // startedAt が未来 (張り付き中) の場合はその分だけ待ちを延ばす
                        const gateBase = (startedAt as number) - new Date().getTime();
                        startGateTimerId = setTimeout(
                            () => {
                                startGateTimedOut = 'soft';
                                decideStart();
                            },
                            Math.max(0, gateBase + gateConfig.timeoutMs),
                        );
                        if (eventId !== null) {
                            hardGateTimerId = setTimeout(
                                () => {
                                    startGateTimedOut = 'hard';
                                    decideStart();
                                },
                                Math.max(0, gateBase + gateConfig.hardTimeoutMs),
                            );
                        }
                    }
                }

                if (gateConfig.enabled === true) {
                    for (const event of parser.write(chunk)) {
                        // 同一 TS には複数サービスの EIT が流れるため、対象サービスのものだけ見る
                        if (event.serviceId !== serviceId) {
                            continue;
                        }
                        if (event.isFollowing === true) {
                            following = event;
                        } else {
                            present = event;
                        }
                        if (firstEitLogged === false) {
                            firstEitLogged = true;
                            this.log.system.info(
                                `first valid EIT: reserveId: ${this.reserve.id},` +
                                    ` kind: ${event.isFollowing === true ? 'following' : 'present'},` +
                                    ` eventId: ${event.eventId}, startAt: ${event.startAt ?? 'unknown'}`,
                            );
                        }
                    }
                }

                decideStart();
            };

            const onStreamClosed = (): void => {
                cleanup();
                reject(
                    new Error(
                        classifyStartFailure('stream-closed', this.isLegacyProgramStream()) === 'error'
                            ? RecorderModel.TRANSPORT_ERROR
                            : RecorderModel.WAITING_FOR_EVENT_ERROR,
                    ),
                );
            };

            stream.on('data', onData);
            stream.once('close', onStreamClosed);
            stream.once('end', onStreamClosed);
            stream.once('error', onStreamClosed);
        });
    }

    /**
     * service stream 録画中の EIT[p/f] を監視し、対象 event の終了で正常終了させる。
     * 開始後の一時的な EIT 欠落は終了条件にしない。
     */
    private setupProgramBoundaryMonitor(initialChunks: Buffer[] = []): void {
        if (this.stream === null) return;
        this.attachProgramBoundaryMonitor(this.stream, initialChunks);
    }

    private attachProgramBoundaryMonitor(source: http.IncomingMessage, initialChunks: Buffer[] = []): void {
        if (this.reserve.programId === null || this.config.recording?.programStreamMode === 'program') {
            return;
        }
        const targetEventId = this.reserve.programId % 100000;
        const serviceId = this.reserve.channelId % 100000;
        const parser = new EitPresentParser();
        if (this.monitoredBoundaryStreams.has(source)) return;
        this.monitoredBoundaryStreams.add(source);
        const inspect = (chunk: Buffer): void => {
            for (const event of parser.write(chunk)) {
                if (event.serviceId !== serviceId || event.isFollowing === true) continue;
                if (event.eventId === targetEventId) {
                    this.boundaryTargetSeen = true;
                    if (event.durationSec === null && this.reserve.isTimeUndefined === true) {
                        void this.extendUndefinedDurationPlan();
                    }
                    if (this.boundaryEndTimerId !== null) {
                        clearTimeout(this.boundaryEndTimerId);
                        this.boundaryEndTimerId = null;
                    }
                    continue;
                }
                if (this.boundaryTargetSeen === false) continue;
                // scheduled-end は本来 RecordingStreamCreator のハードタイマーが閉じる。
                // タイマーを取り逃した場合の保険としてここでも同じ理由で閉じる
                const endReason = decideRecordingEnd({
                    targetEventId,
                    presentEventId: event.eventId,
                    targetConfirmed: this.boundaryTargetSeen,
                    now: new Date().getTime(),
                    endAt: this.reserve.endAt,
                    endMarginMs: this.getTimingConfig().endMarginMs,
                });
                if (endReason === null) continue;
                if (this.boundaryEndTimerId !== null) continue;
                this.log.system.info(
                    `recording boundary changed: reserveId: ${this.reserve.id}, reason: ${endReason},` +
                        ` targetEventId: ${targetEventId}, presentEventId: ${event.eventId}`,
                );
                this.boundaryEndTimerId = setTimeout(() => {
                    this.boundaryEndReason = endReason;
                    if (this.stream !== null) {
                        this.streamCreator.closeStream(this.stream, 'boundary');
                    } else {
                        this.upstreamSession?.stop();
                        void this.recEnd();
                    }
                }, RecorderModel.BOUNDARY_END_DEBOUNCE_MS);
            }
        };
        for (const chunk of initialChunks) inspect(chunk);
        source.on('data', inspect);
    }

    /** 対象番組の present が続く間、Planner の終了時刻だけを延長する */
    private async extendUndefinedDurationPlan(): Promise<void> {
        if (this.plannedEndExtensionInFlight === true) return;
        this.plannedEndExtensionInFlight = true;
        try {
            const hardSafetyEndAt = this.reserve.endAt;
            let plannedEndAt = this.reserve.plannedEndAt;
            if (plannedEndAt === null) {
                const programs = await this.programDB.findSchedule({
                    channelId: this.reserve.channelId,
                    startAt: this.reserve.startAt + 1,
                    endAt: hardSafetyEndAt,
                    isHalfWidth: false,
                });
                const next = programs.find(program => program.startAt > this.reserve.startAt);
                plannedEndAt = resolveProgramEndTimes(this.reserve.startAt, 1, next?.startAt).plannedEndAt;
            }
            const extendedEndAt = extendUndefinedDurationEndAt(Date.now(), plannedEndAt, hardSafetyEndAt);
            if (extendedEndAt === null) return;

            this.reserve.plannedEndAt = extendedEndAt;
            await this.reserveDB.updatePlannedEndAt(this.reserve.id, extendedEndAt);
            await this.reservationManage?.recalculatePlanForReserve(this.reserve.id);
            this.log.system.info(
                `extend undefined-duration planned end: reserveId: ${this.reserve.id},` +
                    ` end: ${formatTimeChange(plannedEndAt, extendedEndAt)}, hardEnd: ${formatLogTime(hardSafetyEndAt)}`,
            );
        } catch (err) {
            this.log.system.error(`extend undefined-duration planned end failed: ${this.reserve.id}`);
            this.log.system.error(err);
        } finally {
            this.plannedEndExtensionInFlight = false;
        }
    }

    /**
     * 録画開始時の録画番組情報追加処理
     * @param recPath: RecFilePathInfo
     * @returns Promise<Recorded>
     */
    private async addRecorded(recPath: RecFilePathInfo): Promise<Recorded> {
        this.log.system.info(`add recorded ${this.reserve.id} ${recPath.fullPath}`);
        try {
            const recorded = await this.createRecorded();
            this.recordedId = await this.recordedDB.insertOnce(recorded);
            recorded.id = this.recordedId;
            await this.persistRecordingSession({ recordedId: this.recordedId });
            this.log.system.info(`recording added reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`);

            // add video file
            const videoFile = new VideoFile();
            videoFile.parentDirectoryName = recPath.parendDir.name;
            videoFile.filePath = path.join(recPath.subDir, recPath.fileName);
            videoFile.type = 'ts';
            videoFile.name = 'TS';
            videoFile.recordedId = this.recordedId;
            // 録画ファイル先頭 (再生位置 0 秒) に対応する実時刻。実況コメントの時刻合わせに使用する
            videoFile.startAt = new Date().getTime();
            this.log.system.info(`create video file: ${videoFile.filePath}`);
            this.videoFileId = await this.videoFileDB.insertOnce(videoFile);
            this.videoFileFullPath = recPath.fullPath;

            recorded.videoFiles = [videoFile];

            return recorded;
        } catch (err: any) {
            // DB 登録エラー
            this.log.system.error('add recorded DB error');
            this.log.system.error(err);
            this.destroyStream();

            // delete file
            await FileUtil.unlink(recPath.fullPath).catch(err => {
                this.log.system.error(`delete error: ${this.reserve.id} ${recPath.fullPath}`);
                this.log.system.error(err);
            });

            if (this.recordedId !== null) {
                await this.recordedDB
                    .deleteRecordedWithRelatedData(this.recordedId, this.dropLogFileId)
                    .catch(cleanupErr => {
                        this.log.system.error(`delete partial recorded error: ${this.recordedId}`);
                        this.log.system.error(cleanupErr);
                    });
                this.recordedId = null;
            }
            this.videoFileId = null;
            throw new Error('AddRecordedDBError');
        }
    }

    private isLegacyProgramStream(): boolean {
        return this.reserve.programId !== null && this.config.recording?.programStreamMode === 'program';
    }

    /** 既存 ITB 互換の終了監視ラッパー。通常録画は RecordingUpstreamSession が担当する。 */
    public async setEndProcess(source: http.IncomingMessage): Promise<void> {
        stream.finished(source, {}, async err => {
            const closeReason = this.streamCreator.getCloseReason(source);
            if (
                closeReason === 'scheduled-end' ||
                closeReason === 'boundary' ||
                closeReason === 'canceled' ||
                closeReason === 'tuner-handoff'
            ) {
                await this.recEnd();
            } else if (err !== undefined && this.recordedId === null) {
                await this.recFailed(err instanceof Error ? err : new Error(String(err)));
            } else if (err !== undefined) {
                this.boundaryEndReason = 'transport-lost';
                await this.recEnd();
            } else {
                await this.recEnd();
            }
        });
    }

    /**
     * 録画失敗処理
     * @param err: Error
     */
    private async recFailed(err: Error, reason: string = 'write-error'): Promise<void> {
        if (this.isFinishing) return;
        this.isFinishing = true;
        this.upstreamSession?.stop();
        await this.finishRecordingAttempt(reason, err);
        this.sessionTracker.closeReasons.push(reason);
        this.boundaryEndReason = reason;
        this.log.system.error(`recording end error reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
        this.log.system.error(err);

        // 録画終了処理
        this.isNeedDeleteReservation = false;
        await this.recEnd(false, true).catch(e => {
            this.log.system.error(`recEnd error reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
            this.log.system.error(e);
        });

        // 録画終了処理失敗を通知
        let recorded: Recorded | null = null;
        if (this.recordedId !== null) {
            try {
                recorded = await this.recordedDB.findId(this.recordedId);
            } catch (e: any) {
                this.log.system.error(`recorded is deleted: ${this.recordedId}`);
                recorded = null;
            }
        }
        this.recordingEvent.emitRecordingFailed(this.reserve, recorded);
    }

    /**
     * this.reserve から Recorded を生成する
     * @return Promise<Recorded>
     */
    private async createRecorded(): Promise<Recorded> {
        const recorded = new Recorded();
        if (this.recordedId !== null) {
            recorded.id = this.recordedId;
        }
        recorded.isRecording = this.isRecording;
        recorded.reserveId = this.reserve.id;
        recorded.ruleId = this.reserve.ruleId;
        recorded.programId = this.reserve.programId;
        recorded.channelId = this.reserve.channelId;

        /**
         * 録画時点の放送局名を保持する
         * 転居などで channel テーブルから放送局情報が失われても表示名を復元できるようにするため
         */
        try {
            const channel = await this.channelDB.findId(this.reserve.channelId);
            if (channel !== null) {
                recorded.channelName = channel.name;
                recorded.halfWidthChannelName = channel.halfWidthName;
            }
        } catch (err: any) {
            this.log.system.warn(`get channel name error: ${this.reserve.channelId}`);
            this.log.system.warn(err);
        }

        recorded.startAt = this.reserve.startAt;
        recorded.endAt = this.reserve.endAt;
        recorded.duration = this.reserve.endAt - this.reserve.startAt;

        if (this.reserve.isTimeSpecified === true) {
            // 時刻指定予約なので channelId と startAt を元に番組情報を取得する
            const program = await this.programDB.findChannelIdAndTime(this.reserve.channelId, this.reserve.startAt);
            if (program === null) {
                // 番組情報が取れなかった場合
                this.log.system.warn(
                    `get program info warn channelId: ${this.reserve.channelId}, startAt: ${this.reserve.startAt}`,
                );
                recorded.name = '';
                recorded.halfWidthName = '';
            } else {
                recorded.name = program.name;
                recorded.halfWidthName = program.halfWidthName;
                recorded.description = program.description;
                recorded.halfWidthDescription = program.halfWidthDescription;
                recorded.extended = program.extended;
                recorded.halfWidthExtended = program.halfWidthExtended;
                recorded.rawExtended = program.rawExtended;
                recorded.rawHalfWidthExtended = program.rawHalfWidthExtended;
                recorded.genre1 = program.genre1;
                recorded.subGenre1 = program.subGenre1;
                recorded.genre2 = program.genre2;
                recorded.subGenre2 = program.subGenre2;
                recorded.genre3 = program.genre3;
                recorded.subGenre3 = program.subGenre3;
                recorded.videoType = program.videoType;
                recorded.videoResolution = program.videoResolution;
                recorded.videoStreamContent = program.videoStreamContent;
                recorded.videoComponentType = program.videoComponentType;
                recorded.audioSamplingRate = program.audioSamplingRate;
                recorded.audioComponentType = program.audioComponentType;
            }
        } else if (this.reserve.name !== null && this.reserve.halfWidthName !== null) {
            recorded.name = this.reserve.name;
            recorded.halfWidthName = this.reserve.halfWidthName;
            recorded.description = this.reserve.description;
            recorded.halfWidthDescription = this.reserve.halfWidthDescription;
            recorded.extended = this.reserve.extended;
            recorded.halfWidthExtended = this.reserve.halfWidthExtended;
            recorded.rawExtended = this.reserve.rawExtended;
            recorded.rawHalfWidthExtended = this.reserve.rawHalfWidthExtended;
            recorded.genre1 = this.reserve.genre1;
            recorded.subGenre1 = this.reserve.subGenre1;
            recorded.genre2 = this.reserve.genre2;
            recorded.subGenre2 = this.reserve.subGenre2;
            recorded.genre3 = this.reserve.genre3;
            recorded.subGenre3 = this.reserve.subGenre3;
            recorded.videoType = this.reserve.videoType;
            recorded.videoResolution = this.reserve.videoResolution;
            recorded.videoStreamContent = this.reserve.videoStreamContent;
            recorded.videoComponentType = this.reserve.videoComponentType;
            recorded.audioSamplingRate = this.reserve.audioSamplingRate;
            recorded.audioComponentType = this.reserve.audioComponentType;
        } else {
            // 時刻指定予約ではないのに、name が null
            throw new Error('CreateRecordedError');
        }

        if (this.dropLogFileId !== null && recorded !== null) {
            recorded.dropLogFileId = this.dropLogFileId;
        }

        return recorded;
    }

    /**
     * 録画終了処理
     */
    private async recEnd(emitFinish: boolean = true, isAlreadyFinishing: boolean = false): Promise<void> {
        if (this.isFinishing && isAlreadyFinishing === false) return;
        this.isFinishing = true;
        this.log.system.info(`start recEnd reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);
        this.upstreamSession?.stop();

        await this.transitionSession('finalize');
        const endReason =
            this.boundaryEndReason ??
            this.sessionTracker.closeReasons[this.sessionTracker.closeReasons.length - 1] ??
            null;
        this.log.system.info(`recording end: reserveId: ${this.reserve.id}, reason: ${endReason ?? 'unknown'}`);
        const resultStatus = this.sessionTracker.resolveResult(endReason, endReason === 'canceled');

        // ファイルへ積んだ TS を drain してから録画情報を確定する。
        if (this.recordingSink !== null) {
            await this.recordingSink.finish().catch(err => {
                this.log.system.error(`recording sink finish failed: ${this.reserve.id}`);
                this.log.system.error(err);
            });
        }

        // stream 停止
        this.destroyStream();
        if (this.isStreamReleased === false) {
            if (typeof this.streamCreator.release === 'function') this.streamCreator.release(this.reserve.id);
            this.isStreamReleased = true;
        }

        // イベントリレーのチェック用タイマーをクリア
        this.eventRelayTimer.clear();

        // 削除予定か?
        if (this.isPlanToDelete === true) {
            this.log.system.info(`plan to delete reserveId: ${this.reserve.id} recordedId: ${this.recordedId}`);

            if (this.dropLogFileId !== null) {
                await this.dropChecker.stop().catch(err => {
                    this.log.system.error(`stop drop checker error: ${this.dropLogFileId}`);
                    this.log.system.error(err);
                });
            }

            await this.persistRecordingSession({
                state: RecordingSessionState.FINISHED,
                actualEndAt: Date.now(),
                endReason,
                resultStatus,
            });
            this.closeTelemetrySession(resultStatus, endReason ?? 'unknown');

            return;
        }

        if (this.recordedId !== null) {
            // remove recording flag
            this.log.system.info(`remove recording flag: ${this.recordedId}`);
            await this.recordedDB.removeRecording(this.recordedId);
            this.isRecording = false;
            await this.recordedDB
                .updateRecordingResult(this.recordedId, {
                    recordingStatus: resultStatus,
                    endReason,
                })
                .catch(err => {
                    this.log.system.warn(`recording result update failed: ${this.recordedId}`);
                    this.log.system.warn(err);
                });

            // tmp に録画していた場合は移動する
            if (typeof this.config.recordedTmp !== 'undefined' && this.videoFileId !== null) {
                try {
                    const newVideoFileFullPath = await this.recordingUtil.movingFromTmp(this.reserve, this.videoFileId);
                    this.videoFileFullPath = newVideoFileFullPath;
                } catch (err: any) {
                    this.log.system.fatal(`movingFromTmp error: ${this.videoFileId}`);
                    this.log.system.fatal(err);
                }
            }

            // update video file size
            if (this.videoFileId !== null && this.videoFileFullPath !== null) {
                this.recordingUtil.updateVideoFileSize(this.videoFileId).catch(err => {
                    this.log.system.error(`update file size error: ${this.videoFileId}`);
                    this.log.system.error(err);
                });
            }

            // drop 情報更新
            await this.updateDropFileLog().catch(err => {
                this.log.system.fatal(`updateDropFileLog error: ${this.dropLogFileId}`);
                this.log.stream.fatal(err);
            });

            // recorded 情報取得
            const recorded = await this.recordedDB.findId(this.recordedId);
            try {
                if (recorded !== null && this.sessionTracker.session !== null) {
                    const attempts = await this.recordingSessionDB.findAttemptsBySessionId(
                        this.sessionTracker.session.id,
                    );
                    const transportGapCount = countRecordingGaps(attempts);
                    Object.assign(recorded, { transportGapCount });
                }
            } catch (err) {
                this.log.system.warn(
                    `recording gap count lookup failed: ${this.sessionTracker.session?.id ?? 'unknown'}`,
                );
                this.log.system.warn(err);
            }

            // Recorded history 追加
            if (
                this.reserve.isTimeSpecified === false &&
                this.reserve.ruleId !== null &&
                this.reserve.isEventRelay === false &&
                this.isNeedDeleteReservation === true
            ) {
                // ルール(Program Id 予約)の場合のみ記録する
                try {
                    if (recorded !== null) {
                        this.log.system.info(`add recorded history: ${this.recordedId}`);
                        const history = new RecordedHistory();
                        history.name = StrUtil.deleteBrackets(recorded.halfWidthName);
                        history.channelId = recorded.channelId;
                        history.endAt = recorded.endAt;
                        await this.recordedHistoryDB.insertOnce(history);
                    }
                } catch (err: any) {
                    this.log.system.error(`add recorded history error: ${this.recordedId}`);
                    this.log.system.error(err);
                }
            }

            // 録画完了の通知
            if (recorded !== null && emitFinish === true) {
                this.log.system.info(
                    `emit finish recording reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, isNeedDeleteReservation: ${this.isNeedDeleteReservation}`,
                );
                this.recordingEvent.emitFinishRecording(this.reserve, recorded, this.isNeedDeleteReservation);
            }
        } else {
            this.log.system.info('failed to recording: recorded id is null');
        }

        await this.transitionSession('finish');
        await this.persistRecordingSession({
            actualEndAt: Date.now(),
            endReason,
            resultStatus,
        });
        this.closeTelemetrySession(resultStatus, endReason ?? 'unknown');

        this.log.system.info(
            `recording finish reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, videoFileFullPath: ${this.videoFileFullPath}`,
        );
    }

    private closeTelemetrySession(status: string, endReason: string): void {
        this.sessionTracker.closeTelemetrySession(status, endReason);
    }

    /**
     * drop log file 情報を更新する
     * @return Promise<void>
     */
    private async updateDropFileLog(): Promise<void> {
        if (this.dropLogFileId === null) {
            return;
        }

        // ドロップ情報カウント
        let error = 0;
        let drop = 0;
        let scrambling = 0;
        try {
            const dropResult = await this.dropChecker.getResult();
            for (const pid in dropResult) {
                error += dropResult[pid].error;
                drop += dropResult[pid].drop;
                scrambling += dropResult[pid].scrambling;
            }
        } catch (err: any) {
            this.log.system.error(`get drop result error: ${this.dropLogFileId}`);
            this.log.system.error(err);
            await this.dropChecker.stop().catch(() => {});

            return;
        }

        // ドロップ数をログに残す
        this.log.system.info({
            recordedId: this.recordedId,
            error: error,
            drop: drop,
            scrambling: scrambling,
        });

        // DB へ反映
        await this.dropLogFileDB
            .updateCnt({
                id: this.dropLogFileId,
                errorCnt: error,
                dropCnt: drop,
                scramblingCnt: scrambling,
            })
            .catch(err => {
                this.log.system.error(`update drop cnt error: ${this.dropLogFileId}`);
                this.log.system.error(err);
            });

        // ドロップ検出通知 (§7.3)
        if (drop > 0 && this.recordedId !== null) {
            void this.notification.dispatch('recording.dropped', {
                recordedId: this.recordedId,
                reserveId: this.reserve.id,
                name: this.reserve.name,
                dropCnt: drop,
                errorCnt: error,
                scramblingCnt: scrambling,
            });
        }
    }

    /**
     * 予約のキャンセル
     */
    private async _cancel(): Promise<void> {
        ++this.prepGeneration;
        if (this.isPrepRecording === false && this.isRecording === false) {
            // 録画処理が開始されていない
            this.timer.clear();
        } else if (this.isPrepRecording === true) {
            this.log.system.info(`cancel preprec: ${this.reserve.id}`);

            // まだ非同期処理を実行しておらず、再試行タイマーを待っているだけなら、
            // CANCEL_EVENT を待つ相手がいない。ここでタイマーを破棄して即時完了する。
            if (this.isPrepRecordInFlight === false && this.prepRetryTimerId !== null) {
                clearTimeout(this.prepRetryTimerId);
                this.prepRetryTimerId = null;
                this.isPlanToDelete = false;
                this.emitCancelEvent();

                return;
            }

            // 録画準備中
            return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
                // タイムアウト設定
                const timerId = setTimeout(() => {
                    this.isStopPrepRec = true;
                    if (this.abortController !== null) {
                        this.abortController.abort();
                    }
                    this.destroyStream();
                    this.isPrepRecording = false;
                    this.isPrepRecordInFlight = false;
                    ++this.prepGeneration;
                    this.isStopPrepRec = false;
                    reject(new Error('PrepRecCancelTimeoutError'));
                }, 60 * 1000);

                // 録画準備中
                this.isStopPrepRec = true;
                if (this.abortController !== null) {
                    this.abortController.abort();
                }
                this.eventEmitter.once(RecorderModel.CANCEL_EVENT, () => {
                    clearTimeout(timerId);
                    // prep rec キャンセル完了
                    resolve();
                });
            });
        } else if (this.isRecording === true) {
            this.log.system.info(`stop recording: ${this.reserve.id}`);
            // 録画中
            if (this.upstreamSession !== null) {
                this.upstreamSession.stop();
            } else if (this.stream !== null) {
                this.streamCreator.closeStream(this.stream, 'canceled');
            }
        }
    }

    /**
     * 予約のキャンセル
     * @param isPlanToDelete: boolean ファイルが削除される予定か
     */
    public async cancel(isPlanToDelete: boolean): Promise<void> {
        this.log.system.info(
            `recording cancel reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}, isPlanToDelete: ${isPlanToDelete}`,
        );

        this.isPlanToDelete = isPlanToDelete;

        if (this.isPrepRecording === true) {
            await this._cancel();
            // 録画準備失敗を通知
            this.recordingEvent.emitCancelPrepRecording(this.reserve);
        } else if (this.isRecording === true) {
            this.isNeedDeleteReservation = false;
            await this._cancel();
        } else {
            await this._cancel();
        }
    }

    /** Operator 停止時に録画先を flush し、予約とセッションを再開可能なまま残す。 */
    public async shutdown(): Promise<void> {
        this.timer.clear();
        this.eventRelayTimer.clear();
        if (this.isRecording === false) return;
        if (this.recordingSink === null) return;

        this.log.system.info(`shutdown recording reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`);
        this.isNeedDeleteReservation = false;
        this.isFinishing = true;
        if (this.boundaryEndTimerId !== null) {
            clearTimeout(this.boundaryEndTimerId);
            this.boundaryEndTimerId = null;
        }

        if (this.upstreamSession !== null) {
            this.upstreamSession.stop('process-shutdown');
        } else if (this.stream !== null) {
            this.streamCreator.closeStream(this.stream, 'process-shutdown');
        }

        await this.recordingSink.finish().catch(err => {
            this.log.system.error(`recording sink finish failed during shutdown: ${this.reserve.id}`);
            this.log.system.error(err);
        });
        await this.finishRecordingAttempt('process-shutdown', undefined, false);
        await this.dropChecker.stop().catch(err => {
            this.log.system.error(`stop drop checker during shutdown failed: ${this.reserve.id}`);
            this.log.system.error(err);
        });
        await this.updateDropFileLog();
        await this.persistRecordingSession({ state: RecordingSessionState.RECORDING });
    }

    /**
     * 予約情報を更新する
     * @param newReserve: 新しい予約情報
     * @param isSuppressLog: boolean ログ出力を抑えるか
     */
    public async update(newReserve: Reserve, isSuppressLog: boolean): Promise<void> {
        if (newReserve.isSkip === true || newReserve.isOverlap === true) {
            // skip されたかチェック
            this.log.system.info(
                `cancel recording by skip or overlap reserveId: ${this.reserve.id}, recordedId: ${this.recordedId}`,
            );
            await this.cancel(false).catch(err => {
                this.log.system.error(`cancel recording error: ${newReserve.id}`);
                this.log.system.error(err);
            });
        } else if (this.reserve.startAt !== newReserve.startAt || this.reserve.endAt !== newReserve.endAt) {
            // 時刻に変更がないか確認
            // EPG 追従で予約時刻が動いたことを変更前後の時刻付きで記録する
            this.log.system.info(
                `reschedule recording: reserveId: ${newReserve.id}, programId: ${newReserve.programId},` +
                    ` start: ${formatTimeChange(this.reserve.startAt, newReserve.startAt)},` +
                    ` end: ${formatTimeChange(this.reserve.endAt, newReserve.endAt)},` +
                    ` state: ${this.isRecording === true ? 'recording' : this.isPrepRecording === true ? 'preparing' : 'waiting'}`,
            );

            // 録画処理が実行されていない場合
            if (this.isPrepRecording === false && this.isRecording === false) {
                this.setTimer(newReserve, isSuppressLog);
            } else {
                // 録画準備中 or 録画中
                if (this.reserve.programId === null) {
                    // 時間指定予約で時刻に変更があった
                    if (this.reserve.startAt !== newReserve.startAt && this.isPrepRecording === true) {
                        // 準備中の開始時刻変更は、古い時刻のストリームと開始ゲートを残さない
                        this.log.system.info(
                            `restart prepare recording after startAt change: ${newReserve.id},` +
                                ` start: ${formatTimeChange(this.reserve.startAt, newReserve.startAt)}`,
                        );
                        await this._cancel().catch(err => {
                            this.log.system.error(`cancel recording error: ${newReserve.id}`);
                            this.log.system.error(err);
                        });
                        // NOTE: キャンセルエラーが発生したとしても新しい時刻でタイマーを再セット
                        this.setTimer(newReserve, isSuppressLog);
                    } else if (this.reserve.endAt !== newReserve.endAt) {
                        // 時間指定予約で終了時刻に変更があった
                        this.log.system.info(
                            `change recording endAt: ${newReserve.id},` +
                                ` end: ${formatTimeChange(this.reserve.endAt, newReserve.endAt)}`,
                        );

                        // 録画準備中でも changeEndAt が新しい endAt を覚えて
                        // stream 取得時に反映するため、ここで待つ必要はない

                        // 終了時刻変更
                        try {
                            this.streamCreator.changeEndAt(newReserve);
                        } catch (err: any) {
                            this.log.system.error(`change recording endAt: ${newReserve.id}`);
                            this.log.system.error(err);
                        }
                    }
                } else {
                    // service stream は programId 予約でも EPG 追従の endAt をハード終了タイマーへ反映する。
                    // legacy program stream の終了は Mirakurun が管理するため、EPGStation 側の終了タイマーは変更しない。
                    if (this.reserve.endAt !== newReserve.endAt) {
                        if (this.config.recording?.programStreamMode !== 'program') {
                            // 録画準備中に届いた変更は changeEndAt が覚えておき、
                            // stream 取得時 (registerStream) に反映される
                            try {
                                this.streamCreator.changeEndAt(newReserve);
                            } catch (err: any) {
                                this.log.system.error(`change recording endAt: ${newReserve.id}`);
                                this.log.system.error(err);
                            }
                        }
                        // 録画中に終了時間が変更されたらイベントリレーの確認タイマーも再設定する
                        if (this.isRecording === true) this.setEventRelayTimer(newReserve);
                    }

                    if (this.reserve.startAt < newReserve.startAt) {
                        // 開始時刻が遅くなった
                        if (this.isRecording === false) {
                            // まだ録画準備中なのでキャンセルしてタイマーを再セット
                            this.log.system.info(
                                `cancel prepare recording.`,
                                `(reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}, recordedId: ${this.recordedId},` +
                                    ` start: ${formatTimeChange(this.reserve.startAt, newReserve.startAt)})`,
                            );
                            await this._cancel().catch(err => {
                                this.log.system.error(
                                    `cancel recording error: (reserveId: ${newReserve.id}, programId: ${this.reserve.programId})`,
                                );
                                this.log.system.error(err);
                            });
                            // NOTE: キャンセルエラーが発生したとしてもタイマーを再セット
                            this.setTimer(newReserve, isSuppressLog);
                        } else {
                            // 録画中
                            // NOTE:
                            //  EPGstationがスケジュール変更を遅れて把握した可能性がある
                            //  一度ストリームを開始した番組の開始時刻が変更されることはないのでここでは何もしない
                            this.log.system.info(
                                `Ignores schedule changes because this program is already recording.`,
                                ` (reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}, recordedId: ${this.recordedId},` +
                                    ` start: ${formatTimeChange(this.reserve.startAt, newReserve.startAt)})`,
                            );
                        }
                    }
                }
            }
        }

        this.reserve = newReserve;

        // update recorded DB
        if (this.isRecording === true && this.recordedId !== null) {
            const recorded = await this.createRecorded();
            this.log.system.info(`update recorded: ${this.recordedId}`);
            this.recordedDB.updateOnce(recorded);
        }
    }

    /**
     * 現在の config から録画タイミング (張り付き・開始マージン・終了マージン) を解決する
     * @return RecordingTimingConfig
     */
    private getTimingConfig(): RecordingTimingConfig {
        return resolveRecordingTimingConfig(
            this.config.recording,
            this.config.timeSpecifiedStartMargin,
            this.config.timeSpecifiedEndMargin,
        );
    }

    /**
     * イベントリレーをチェックするためのタイマーをセットする
     * @param reserve: Reserve 予約情報
     */
    private setEventRelayTimer(reserve: Reserve): void {
        // 除外, 重複しているものはタイマーをセットしない
        if (reserve.isSkip === true || reserve.isOverlap === true) {
            return;
        }

        // 待機時間を計算
        const now = new Date().getTime();
        let time = reserve.endAt - RecorderModel.EVENT_RELAY_CHECK_TIME - now;
        if (time < 0) {
            time = 0;
        }

        // タイマーをセットする
        this.isEventRelayTimerSet = true;
        this.eventRelayTimer.set(async () => {
            await this.checkEventRelay();
        }, time);
    }

    /**
     * イベントリレーの対象となる予約情報の確認を行う
     */
    private async checkEventRelay(): Promise<void> {
        // ProgramId の指定がない場合は何もしない
        if (this.reserve.programId === null) {
            return;
        }

        this.log.system.debug(
            `check event relay program. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
        );
        const mirakurun = this.mirakurunClientModel.getClient();

        // program 情報の取得
        let parentProgram: mapid.Program;
        try {
            parentProgram = await mirakurun.getProgram(this.reserve.programId);
            this.log.system.debug(parentProgram);
        } catch (err: any) {
            this.log.system.error(
                `failed to get event relay info. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
            );
            return;
        }

        // event relay の設定の有無を調べる
        if (typeof parentProgram.relatedItems === 'undefined') {
            this.log.system.debug(
                `event relay porgram does not exist. reserveId: ${this.reserve.id}, programId: ${this.reserve.programId}`,
            );
            return;
        }

        // event relay 対象の ProgramId のリストを作成する
        const reserveProgramIds: { programId: apid.ProgramId; parentReserve: Reserve }[] = [];
        for (const relatedItem of parentProgram.relatedItems) {
            // type が ralay 出ないなら skip
            if (relatedItem.type !== 'relay') {
                continue;
            }

            // 番組を予約するための networkId を生成する
            let networkId = relatedItem.networkId;
            if (typeof networkId === 'undefined' || networkId === null) {
                // 本来 networkId は null を取らないはずだが、mirakc は null を返す
                // networkId が存在しない場合は自ネットワークのイベントリレーと判断する
                networkId = parentProgram.networkId;
            }

            // networkId, serviceId, eventId から該当する番組情報を検索する
            const reserveProgram = await this.programDB.findEventRelayProgram(
                networkId,
                relatedItem.serviceId,
                relatedItem.eventId,
            );
            if (reserveProgram === null) {
                this.log.system.warn(
                    `event relay program is not found. networkId: ${networkId}, serviceId: ${relatedItem.serviceId}, eventId: ${relatedItem.eventId}`,
                );
                continue;
            }

            // 予約に必要な情報を詰める
            // parentReserve は deep copy して渡す
            reserveProgramIds.push({ programId: reserveProgram.id, parentReserve: Object.assign({}, this.reserve) });
            this.log.system.info(
                `set event relay program. programId ${this.reserve.programId} -> ${reserveProgram.id}`,
            );
        }

        // イベントリレーの ProgramId が存在するなら予約を依頼する
        if (reserveProgramIds.length > 0) {
            this.recordingEvent.emitEventRelay(reserveProgramIds);
        }
    }

    /**
     * タイマーを再設定する
     * @return boolean セットに成功したら true を返す
     */
    public resetTimer(): boolean {
        // 録画中ならイベントリレーのチェック用のタイマーを再設定
        if (this.isRecording === true) {
            if (this.isEventRelayTimerSet === true) {
                this.setEventRelayTimer(this.reserve);
            }
            return true;
        }

        return this.setTimer(this.reserve, false);
    }
}

namespace RecorderModel {
    export const CANCEL_EVENT = 'RecordingCancelEvent';
    export const START_RECORDING_EVENT = 'StartRecordingEvent';
    export const EVENT_RELAY_CHECK_TIME = 20 * 1000; // イベントリレーの確認時間 20秒
    export const BOUNDARY_END_DEBOUNCE_MS = 2 * 1000;
    // 「番組がまだ始まっていない」ことを示すエラー。
    // legacy program stream の無データ待ちや service stream の transport 異常を、
    // 通常のチューナー取得エラーと区別して再試行する
    export const WAITING_FOR_EVENT_ERROR = 'WaitingForEventStart';
    export const TRANSPORT_ERROR = 'RecordingTransportError';
}

export default RecorderModel;
