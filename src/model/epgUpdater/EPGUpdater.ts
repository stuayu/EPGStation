import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateManageModel, { EPGUpdateEvent } from './IEPGUpdateManageModel';
import IEPGUpdater from './IEPGUpdater';
import Util from '../../util/Util';

@injectable()
class EPGUpdater implements IEPGUpdater {
    private log: ILogger;
    private config: IConfigFile;
    private updateManage: IEPGUpdateManageModel;

    private isEventStreamAlive: boolean = false;
    private lastUpdatedTime: number = 0;
    private lastDeletedTime: number = 0;
    private retryCount: number = 0;

    private static readonly EVENT_STREAM_REONNECTION_MAX = 12;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEPGUpdateManageModel') updateManage: IEPGUpdateManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.updateManage = updateManage;

        this.updateManage.on(EPGUpdateEvent.PROGRAM_UPDATED, () => {
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
        });

        this.updateManage.on(EPGUpdateEvent.SERVICE_UPDATED, () => {
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
        });

        this.updateManage.on(EPGUpdateEvent.STREAM_STARTED, async () => {
            this.log.system.info('event stream started');
            this.retryCount = 0;
            try {
                await this.updateManage.updateAll();
                this.notify();
            } catch (err: any) {
                this.log.system.error('updateAll error');
            }
            // updateAllが完了して以降、queueフラッシュ処理を有効にするために
            // この位置でisEventStreamAliveをtrueにする
            this.lastUpdatedTime = new Date().getTime();
            this.isEventStreamAlive = true;
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

        // event streamを開始
        this.startEventStreamAnalysis();

        // 放送中や放送開始時刻が間近の番組は短いサイクルでDBへ保存する
        // NOTE: DB負荷などを考慮しEvent受信と同時のDB反映は見合わせる
        setInterval(async () => {
            const now = new Date().getTime();

            try {
                if (this.isEventStreamAlive === true) {
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
                } else if (this.isEventStreamAlive === false && this.lastUpdatedTime + updateInterval * 1.5 <= now) {
                    // NOTE mirakc 暫定対応。本来は Server-Sent Events への対応が必要
                    await this.updateManage.updateAll();
                    this.notify();
                }
            } catch (err: any) {
                this.log.system.error('EPG update error');
                this.log.system.error(err);
            }

            if (this.lastDeletedTime + updateInterval <= now) {
                // 古い番組情報を削除
                await this.updateManage.deleteOldPrograms().catch(err => {
                    this.log.system.error('delete old programs error');
                    this.log.system.error(err);
                });
                this.lastDeletedTime = now;
            }
        }, 10 * 1000);
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
     * 親プロセスへ更新が完了したことを知らせる
     */
    private notify(): void {
        if (typeof process.send !== 'undefined') {
            process.send({ msg: 'updated' });
        }
    }
}

export default EPGUpdater;
