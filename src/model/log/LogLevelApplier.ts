import { inject, injectable } from 'inversify';
import IAppSettingDB from '../db/IAppSettingDB';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ILogLevelApplier from './ILogLevelApplier';
import { LOG_CATEGORIES, resolveLogLevels } from './LogLevel';

/**
 * ログレベルの実適用。
 * Operator / Service / EPGUpdater の各プロセスが自分の log4js に対して呼ぶ。
 * log4js のロガーは level を代入するだけで即座に切り替わるため、再初期化は不要
 */
@injectable()
export default class LogLevelApplier implements ILogLevelApplier {
    // app_setting のトップレベルキー
    public static readonly SETTING_KEY = 'logging';

    private log: ILogger;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IAppSettingDB') private db: IAppSettingDB,
    ) {
        this.log = logger.getLogger();
    }

    public async apply(): Promise<void> {
        let levels;
        try {
            const settings = await this.db.getAll();
            levels = resolveLogLevels(settings[LogLevelApplier.SETTING_KEY]);
        } catch (err) {
            // DB 未接続などで読めなくても、ファイル設定のまま動作を継続する
            return;
        }

        const applied: string[] = [];
        for (const category of LOG_CATEGORIES) {
            const level = levels[category];
            if (typeof level === 'undefined') continue;
            this.log[category].level = level;
            applied.push(`${category}=${level}`);
        }
        if (applied.length > 0) this.log.system.info(`log level applied from settings: ${applied.join(', ')}`);
    }
}
