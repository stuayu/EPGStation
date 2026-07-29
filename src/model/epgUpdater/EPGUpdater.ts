import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { isFeatureEnabled } from '../FeatureFlags';
import IProgramSeriesApiModel from '../api/schedule/IProgramSeriesApiModel';
import IEPGUpdateManageModel, { EPGUpdateEvent, TunerServerType } from './IEPGUpdateManageModel';
import IEPGUpdater from './IEPGUpdater';
import Util from '../../util/Util';

@injectable()
class EPGUpdater implements IEPGUpdater {
    private log: ILogger;
    private config: IConfigFile;
    private updateManage: IEPGUpdateManageModel;

    private isEventStreamAlive: boolean = false;
    private lastUpdatedTime: number = 0;
    private lastEventStreamUpdatedTime: number = 0;
    private lastDeletedTime: number = 0;
    private retryCount: number = 0;

    // EPG 更新系タスク (updateAll / saveProgram / deleteOldPrograms) の排他制御用ロック。
    // updateAll は program の全削除 + 全挿入を行う重い処理のため、並行実行すると
    // DELETE FROM program 同士が競合して MySQL の Lock wait timeout (ER_LOCK_WAIT_TIMEOUT) が発生する
    private updateTaskLock: Promise<void> = Promise.resolve();
    private isUpdateTaskRunning: boolean = false;

    private static readonly EVENT_STREAM_REONNECTION_MAX = 12;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEPGUpdateManageModel') updateManage: IEPGUpdateManageModel,
        @inject('IProgramSeriesApiModel') private programSeries: IProgramSeriesApiModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.updateManage = updateManage;

        this.updateManage.on(EPGUpdateEvent.PROGRAM_UPDATED, (programIds?: number[]) => {
            this.lastEventStreamUpdatedTime = new Date().getTime();
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
            if (programIds && programIds.length > 0) this.precomputeProgramSeries(programIds);
        });

        // EIT[p/f] 相当の更新は 10 秒周期の短サイクルでも即座にクライアントへ伝える
        // (視聴中の番組情報・番組表をその場で書き換えるため)
        this.updateManage.on(EPGUpdateEvent.ON_AIR_PROGRAM_UPDATED, (channelIds?: number[]) => {
            if (typeof process.send === 'undefined' || !channelIds || channelIds.length === 0) return;
            process.send({ msg: 'onAirProgramUpdated', channelIds });
        });

        this.updateManage.on(EPGUpdateEvent.SERVICE_UPDATED, () => {
            this.lastEventStreamUpdatedTime = new Date().getTime();
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
        });

        this.updateManage.on(EPGUpdateEvent.STREAM_STARTED, async () => {
            this.log.system.info('event stream started');
            this.retryCount = 0;
            // 定期実行タスクの updateAll と同時に走らないよう排他制御する
            await this.runExclusiveUpdateTask(async () => {
                try {
                    await this.updateManage.updateAll();
                    this.notify();
                } catch (err: any) {
                    this.log.system.error('updateAll error');
                }
                // updateAllが完了して以降、queueフラッシュ処理を有効にするために
                // この位置でisEventStreamAliveをtrueにする
                const now = new Date().getTime();
                this.lastUpdatedTime = now;
                // updateAll 後は全件数削除が行われるため削除時間も更新する
                this.lastDeletedTime = now;
                this.lastEventStreamUpdatedTime = now;
                this.isEventStreamAlive = true;
            });
        });

        this.updateManage.on(EPGUpdateEvent.STREAM_ABORTED, () => {
            this.log.system.info('has disconnected from the mirakurun');
            this.isEventStreamAlive = false;
        });
    }

    /**
     * EPG 更新処理開始
     */
    public async start(): Promise<void> {
        this.log.system.info('start EPG update');

        const updateInterval = this.config.epgUpdateIntervalTime * 60 * 1000;
        // 過去の番組表データの削除間隔 (省略時は EPG 更新間隔と同じ)
        const deleteInterval =
            typeof this.config.epgDeleteIntervalTime === 'number' && this.config.epgDeleteIntervalTime > 0
                ? this.config.epgDeleteIntervalTime * 60 * 1000
                : updateInterval;

        // チューナーサーバの種別を確認
        const tunerServerType = await this.updateManage.checkTunerServerType();

        // event streamを開始
        this.startEventStreamAnalysis();

        // 放送中や放送開始時刻が間近の番組は短いサイクルでDBへ保存する
        // NOTE: DB負荷などを考慮しEvent受信と同時のDB反映は見合わせる
        setInterval(async () => {
            // 前回の更新処理が実行中の間は tick をスキップする。
            // スキップしないと、番組数が多く updateAll に時間がかかる環境では
            // ウォッチドッグ判定 (lastEventStreamUpdatedTime) が更新される前に次の tick が発火し、
            // updateAll が多重起動されて DELETE FROM program 同士が競合し Lock wait timeout となる
            if (this.isUpdateTaskRunning === true) {
                return;
            }

            await this.runExclusiveUpdateTask(async () => {
                const now = new Date().getTime();

                try {
                    if (this.isEventStreamAlive === true) {
                        if (tunerServerType === TunerServerType.mirakurun) {
                            // mirakurun の場合
                            await this.updateMirakurunEventStream(updateInterval, now);
                        } else {
                            // mirakc の場合
                            await this.updateMirakcEvent(updateInterval, now);
                        }
                    } else if (
                        this.isEventStreamAlive === false &&
                        this.lastUpdatedTime + updateInterval * 1.5 <= now
                    ) {
                        await this.updateManage.updateAll();
                        this.lastUpdatedTime = now;
                        // updateAll 後は全件数削除が行われるため削除時間も更新する
                        this.lastDeletedTime = now;
                        this.lastEventStreamUpdatedTime = now;
                        this.notify();
                    }

                    if (
                        this.isEventStreamAlive === true &&
                        this.lastEventStreamUpdatedTime !== 0 &&
                        this.lastEventStreamUpdatedTime + updateInterval * 1.5 <= now
                    ) {
                        // 長時間 event stream から更新が無い場合は全件更新を実施する
                        this.log.system.warn('no epg event updates for a long time, running full refresh');
                        await this.updateManage.updateAll();
                        this.lastUpdatedTime = now;
                        // updateAll 後は全件数削除が行われるため削除時間も更新する
                        this.lastDeletedTime = now;
                        this.lastEventStreamUpdatedTime = now;
                        this.notify();
                    }
                } catch (err: any) {
                    this.log.system.error('EPG update error');
                    this.log.system.error(err);
                }

                if (this.lastDeletedTime + deleteInterval <= now) {
                    // 古い番組情報を削除
                    await this.updateManage.deleteOldPrograms().catch(err => {
                        this.log.system.error('delete old programs error');
                        this.log.system.error(err);
                    });
                    this.lastDeletedTime = now;
                }
            });
        }, 10 * 1000);
    }

    /**
     * EPG 更新系タスクを直列化して実行する
     * event stream 開始時の updateAll と定期実行タスクが同時に走らないようにする
     * @param task: 実行するタスク
     * @return Promise<void> タスクの完了を待つ Promise
     */
    private runExclusiveUpdateTask(task: () => Promise<void>): Promise<void> {
        const run = this.updateTaskLock.then(async () => {
            this.isUpdateTaskRunning = true;
            try {
                await task();
            } finally {
                this.isUpdateTaskRunning = false;
            }
        });
        this.updateTaskLock = run.catch(() => {});

        return run;
    }

    /**
     * mirakurun の event stream 解析開始
     * stream に問題が発生した場合は this.isEventStreamAlive が false になる
     */
    private async startEventStreamAnalysis(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('trying to connecting to the mirakurun');
                await this.updateManage.start();
            } catch (err: any) {
                this.log.system.error('destroy event stream');

                // スリープ時間が 60 秒を超えないようにチェック
                if (this.retryCount < EPGUpdater.EVENT_STREAM_REONNECTION_MAX) {
                    this.retryCount++;
                }
                const retryInterval = this.retryCount * 5 * 1000;
                await Util.sleep(retryInterval);
            }
        }
    }

    /**
     * mirakurun の event stream の解析結果を保存する
     * @param updateInterval: number 更新間隔 (ミリ秒)
     * @param now: 現在時刻 エポックミリ秒
     */
    private async updateMirakurunEventStream(updateInterval: number, now: number): Promise<void> {
        if (this.lastUpdatedTime + updateInterval > now) {
            // updateInterval 分だけ経過するまでは直近の5分間のデータのみ更新する
            await this.updateManage.saveProgram(now + 5 * 60 * 1000).catch(e => {
                this.log.system.error('program update error');
                throw e;
            });
        } else {
            // updateInterval 分だけ経過したのですべてのデータを更新する
            await this.updateManage.saveService().catch(e => {
                this.log.system.error('service update error');
                throw e;
            });
            await this.updateManage.saveProgram().catch(e => {
                this.log.system.error('program update error');
                throw e;
            });
            this.lastUpdatedTime = now;

            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため追加
            this.notify();
        }
    }

    /**
     * mirakc の /events の解析結果を元に番組情報を更新する
     * @param updateInterval
     * @param now
     */
    private async updateMirakcEvent(updateInterval: number, now: number): Promise<void> {
        // 放映中のものはすぐに更新する
        await this.updateManage.saveOnAirServices().catch(e => {
            this.log.system.error('failed to save onair services');
            throw e;
        });

        // 放映中以外の者は updateInterval の間隔で更新する
        if (this.lastUpdatedTime + updateInterval <= now) {
            // NOTE await を付けないと失敗時に unhandledRejection になる
            await this.updateManage.saveUpdateServices().catch(e => {
                this.log.system.error('failed to save update services');
                throw e;
            });
            this.lastUpdatedTime = now;

            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため追加
            this.notify();
        }
    }

    /**
     * EPG 更新で変更があった番組について、シリーズ対応の事前マッピングを計算する (§4.10)。
     * feature flag が無効な場合や外部要因での失敗は EPG 更新自体に影響させない (graceful degradation)
     */
    private precomputeProgramSeries(programIds: number[]): void {
        if (!isFeatureEnabled(this.config, 'seriesLibrary') || !isFeatureEnabled(this.config, 'programSeriesMapping'))
            return;
        this.programSeries.precompute(programIds).catch(err => {
            this.log.system.warn('program series precompute error');
            this.log.system.warn(err);
        });
    }

    /**
     * 親プロセスへ更新が完了したことを知らせる
     */
    private notify(): void {
        if (typeof process.send !== 'undefined') {
            process.send({ msg: 'updated' });
        }
    }
}

export default EPGUpdater;
