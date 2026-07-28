import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import ILoggerModel from '../ILoggerModel';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IEncodeFinishModel from './encode/IEncodeFinishModel';
import IEncodeManageModel from './encode/IEncodeManageModel';
import ILogLevelApplier from '../log/ILogLevelApplier';
import IServiceServer from './IServiceServer';
install();

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'serviceLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

// 画面から変更されたログレベルを反映する (ログ設定ファイルの内容を上書きする)
container
    .get<ILogLevelApplier>('ILogLevelApplier')
    .apply()
    .catch(err => log.system.error(err));

const encodeFinishModel = container.get<IEncodeFinishModel>('IEncodeFinishModel');
encodeFinishModel.set();

const serviceServer = container.get<IServiceServer>('IServiceServer');

/**
 * 前回終了時に残っていたエンコードキューを復元してから待ち受けを開始する
 * (復元前に push されると encodeId が衝突する恐れがあるため、復元完了後に start する)
 */
const encodeManageModel = container.get<IEncodeManageModel>('IEncodeManageModel');
encodeManageModel
    .restore()
    .catch(err => {
        log.system.error('restore encode queue error');
        log.system.error(err);
    })
    .then(() => {
        try {
            serviceServer.start();
        } catch (err: any) {
            log.system.fatal(err);
            process.exit(1);
        }
    });
