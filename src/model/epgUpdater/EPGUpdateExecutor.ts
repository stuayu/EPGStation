import * as path from 'path';
import 'reflect-metadata';
import ILoggerModel from '../ILoggerModel';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IConfigOverlayLoader from '../config/IConfigOverlayLoader';
import ILogLevelApplier from '../log/ILogLevelApplier';
import IEPGUpdater from './IEPGUpdater';

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'epgUpdaterLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

(async () => {
    // 画面から変更された設定 (config.yml への重ね書き) を先に適用する。
    // EPGUpdater はコンストラクタで config を読むため、構築より前に済ませる
    await container
        .get<IConfigOverlayLoader>('IConfigOverlayLoader')
        .load()
        .catch(err => log.system.error(err));
    await container
        .get<ILogLevelApplier>('ILogLevelApplier')
        .apply()
        .catch(err => log.system.error(err));

    const updater = container.get<IEPGUpdater>('IEPGUpdater');

    // 初回更新 or event stream 更新時にエラーが発生する
    log.system.debug('start EPGUpdateExecutor.js');
    await updater.start().catch(() => {
        process.exit(1);
    });
})();
