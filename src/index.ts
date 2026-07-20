import * as child_process from 'child_process';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import IEPGUpdateExecutorManageModel from './model/epgUpdater/IEPGUpdateExecutorManageModel';
import IEventSetter from './model/event/IEventSetter';
import IConfiguration from './model/IConfiguration';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILoggerModel from './model/ILoggerModel';
import IMirakurunClientModel from './model/IMirakurunClientModel';
import IIPCServer from './model/ipc/IIPCServer';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import IRecordingManageModel from './model/operator/recording/IRecordingManageModel';
import IReservationManageModel from './model/operator/reservation/IReservationManageModel';
import IStorageManageModel from './model/operator/storage/IStorageManageModel';
install();

containerSetter.set(container);

namespace IndexConstants {
    // mirakurun 未接続時にチューナー情報取得をバックグラウンドで再試行する間隔 (ms)
    export const TUNER_RETRY_INTERVAL = 30 * 1000;
}

/**
 * 初期処理
 */
const init = async () => {
    const logger = container.get<ILoggerModel>('ILoggerModel');
    logger.initialize();

    const log = logger.getLogger();
    process.on('uncaughtException', err => {
        log.system.fatal(`uncaughtException: ${err.message}`);
        log.system.fatal(err);
    });

    process.on('unhandledRejection', err => {
        log.system.fatal('unhandledRejection');
        log.system.fatal(err);
    });

    const config = container.get<IConfiguration>('IConfiguration').getConfig();

    // set uid & gid
    if (process.platform !== 'win32' && typeof process.getuid !== 'undefined' && process.getuid() === 0) {
        // gid
        if (typeof process.setgid !== 'undefined') {
            if (typeof config.gid === 'string' || typeof config.gid === 'number') {
                process.setgid(config.gid);
            } else {
                process.setgid('video');
            }
        }

        // uid
        if (typeof process.setuid !== 'undefined') {
            if (typeof config.uid === 'string' || typeof config.uid === 'number') {
                process.setuid(config.uid);
            }
        }
    }

    // uid, gid が設定されてから再度 log 再設定
    logger.initialize(path.join(__dirname, '..', 'config', 'operatorLogConfig.yml'));

    // 接続確認
    const connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
    // mirakurun への接続確認 (有限回のリトライで打ち切り、失敗しても起動は継続する)
    await connectionChecker.checkMirakurun();

    // wait DB (DB は必須依存のため接続できるまで待ち続ける)
    await connectionChecker.checkDB();
};

/**
 * mirakurun からチューナー情報を取得し、予約・録画管理へ反映する
 * 取得に失敗した場合は IndexConstants.TUNER_RETRY_INTERVAL 間隔でバックグラウンドリトライを開始する
 */
const setTunersWithRetry = async (): Promise<void> => {
    const client = container.get<IMirakurunClientModel>('IMirakurunClientModel').getClient();
    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    try {
        const tuners = await client.getTuners();
        reservationManageModel.setTuners(tuners);
        recordingManager.setTuner(tuners);
    } catch (err: any) {
        log.system.warn('mirakurun からチューナー情報を取得できませんでした');
        log.system.warn(
            'config.yml の mirakurunPath の設定と、Mirakurun サービスが起動しているかを確認してください',
        );
        log.system.warn('チューナー無しで起動を継続し、以後バックグラウンドで再接続を試みます');

        // チューナー無しでいったん起動を継続する
        reservationManageModel.setTuners([]);
        recordingManager.setTuner([]);

        // バックグラウンドで定期的に再接続を試みる
        const timer = setInterval(async () => {
            try {
                const tuners = await client.getTuners();
                reservationManageModel.setTuners(tuners);
                recordingManager.setTuner(tuners);
                log.system.info('mirakurun への接続が復旧しました');
                clearInterval(timer);
            } catch (retryErr: any) {
                // 復旧するまでリトライを継続する
            }
        }, IndexConstants.TUNER_RETRY_INTERVAL);
    }
};

/**
 * Operator 機能起動処理
 */
const runOperator = async () => {
    const eventSetter = container.get<IEventSetter>('IEventSetter');
    eventSetter.set();

    await setTunersWithRetry();

    const storageManageModel = container.get<IStorageManageModel>('IStorageManageModel');
    storageManageModel.start();
};

/**
 * Service 起動処理
 */
const runService = async () => {
    const child = child_process.spawn(
        process.argv[0],
        [path.join(__dirname, 'model', 'service', 'ServiceExecutor.js')],
        {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
    );

    // 終了したら再起動
    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    child.once('exit', () => {
        log.system.fatal('service process is down');
        log.system.fatal('restart service');
        runService();
    });
    child.once('error', () => {
        runService();
    });

    // buffer が埋まらないようにする
    if (child.stdout !== null) {
        child.stdout.on('data', () => {});
    }
    if (child.stderr !== null) {
        child.stderr.on('data', () => {});
    }

    // IPC 通信設定
    const ipcServer = container.get<IIPCServer>('IIPCServer');
    ipcServer.register(child);

    log.system.info(`start service pid: ${child.pid}`);

    // TODO ping pong
};

/**
 * クリーンアップ処理
 */
const cleanup = async () => {
    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    await recordingManager.cleanup();
    await reservationManageModel.cleanup();
};

/**
 * EPGUpdater 起動処理
 */
const runEPGUpdater = async () => {
    const epgUpdateExecutorManageModel = container.get<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel');
    epgUpdateExecutorManageModel.execute();
};

(async () => {
    try {
        await init();
    } catch (err: any) {
        console.error('initialize error');
        console.error(err);
        process.exit(1);
    }

    await runOperator();

    await runService();

    await cleanup();

    await runEPGUpdater();
})();
