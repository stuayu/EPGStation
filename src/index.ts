import * as child_process from 'child_process';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import IEPGUpdateExecutorManageModel from './model/epgUpdater/IEPGUpdateExecutorManageModel';
import IEventSetter from './model/event/IEventSetter';
import IConfiguration from './model/IConfiguration';
import { isFeatureEnabled } from './model/FeatureFlags';
import IUpdateManageModel from './model/update/IUpdateManageModel';
import ILogLevelApplier from './model/log/ILogLevelApplier';
import IConfigOverlayLoader from './model/config/IConfigOverlayLoader';
import IAppSettingChangeEvent from './model/event/IAppSettingChangeEvent';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILoggerModel from './model/ILoggerModel';
import IMirakurunClientModel from './model/IMirakurunClientModel';
import IIPCServer from './model/ipc/IIPCServer';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import IAnnictWorkDictionary from './model/metadata/annict/IAnnictWorkDictionary';
import IWikidataProgramDictionary from './model/metadata/wikidata/IWikidataProgramDictionary';
import ISyobocalTitleDictionary from './model/metadata/syobocal/ISyobocalTitleDictionary';
import IImportWatchManageModel from './model/operator/recorded/IImportWatchManageModel';
import ISeriesStartupPipeline from './model/operator/series/ISeriesStartupPipeline';
import ISeriesMetadataFiller from './model/series/ISeriesMetadataFiller';
import IRecordingManageModel from './model/operator/recording/IRecordingManageModel';
import IReservationManageModel from './model/operator/reservation/IReservationManageModel';
import IStorageManageModel from './model/operator/storage/IStorageManageModel';
import { isShuttingDown, registerChildProcess } from './util/ChildProcessRegistry';
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

    // 画面から変更された設定 (config.yml への重ね書き) を適用する。
    // 多くのモデルはコンストラクタで config を読むため、モデル構築より先に済ませる
    await container.get<IConfigOverlayLoader>('IConfigOverlayLoader').load();
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
        log.system.warn('config.yml の mirakurunPath の設定と、Mirakurun サービスが起動しているかを確認してください');
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

    // 外部録画ファイル取り込みディレクトリの自動監視 (config.importWatch: true の場合のみ動作する)
    const importWatchManageModel = container.get<IImportWatchManageModel>('IImportWatchManageModel');
    importWatchManageModel.start();

    // しょぼいカレンダーのアニメ作品タイトル辞書を定期的に取り込む
    // (featureFlags.metadataProviders + しょぼいカレンダー連携が有効な場合のみ実際に取得する)
    const syobocalTitleDictionary = container.get<ISyobocalTitleDictionary>('ISyobocalTitleDictionary');
    syobocalTitleDictionary.startAutoSync();

    // Annict の作品辞書 (英題・ローマ字・syobocalTid 対応表) を定期的に取り込む
    // (featureFlags.metadataProviders + Annict 連携が有効かつトークン設定済みの場合のみ実際に取得する)
    const annictWorkDictionary = container.get<IAnnictWorkDictionary>('IAnnictWorkDictionary');
    annictWorkDictionary.startAutoSync();

    // Wikidata の全ジャンル番組辞書 (ドラマ・バラエティ・情報番組・ローカル番組) を定期的に取り込む
    // (featureFlags.metadataProviders + Wikidata 連携が有効な場合のみ実際に取得する)
    const wikidataProgramDictionary = container.get<IWikidataProgramDictionary>('IWikidataProgramDictionary');
    wikidataProgramDictionary.startAutoSync();

    // 作品辞書の導入前に作られたシリーズにはクール・読み仮名・総話数が入っていないため、
    // 辞書の同期が終わったころに一度だけ埋める (一覧の絞り込み・並べ替えに使う)
    const seriesMetadataFiller = container.get<ISeriesMetadataFiller>('ISeriesMetadataFiller');
    seriesMetadataFiller.scheduleInitialFill();

    // 作品辞書の同期完了を待ってから、シリーズ未リンクの録画の再照合 (バックフィル) までを全自動で実行する
    // (featureFlags.seriesLibrary 有効時のみ。seriesStartup.enable: false で無効化できる)
    const seriesStartupPipeline = container.get<ISeriesStartupPipeline>('ISeriesStartupPipeline');
    seriesStartupPipeline.schedule();

    // 設定変更を受け取って再適用できるようにする
    const configOverlayLoader = container.get<IConfigOverlayLoader>('IConfigOverlayLoader');
    const logLevelApplier = container.get<ILogLevelApplier>('ILogLevelApplier');
    await logLevelApplier.apply();
    container.get<IAppSettingChangeEvent>('IAppSettingChangeEvent').setChanged(keys => {
        if (keys.includes('logging') === true) void logLevelApplier.apply();
        if (keys.includes('config') === true) void configOverlayLoader.load();
    });

    // 新しいバージョンの公開を定期的に確認する (featureFlags.updateNotification 有効時のみ)
    if (isFeatureEnabled(container.get<IConfiguration>('IConfiguration').getConfig(), 'updateNotification')) {
        container.get<IUpdateManageModel>('IUpdateManageModel').startAutoCheck();
    }
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

    // Operator が自分で終了するとき (再起動・更新) にまとめて止められるようにする
    registerChildProcess(child);

    // 終了したら再起動
    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    child.once('exit', () => {
        // 自分から止めた場合は再起動しない (後継プロセスの Service とポートを取り合ってしまう)
        if (isShuttingDown() === true) return;

        log.system.fatal('service process is down');
        log.system.fatal('restart service');
        runService();
    });
    child.once('error', () => {
        if (isShuttingDown() === true) return;

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
