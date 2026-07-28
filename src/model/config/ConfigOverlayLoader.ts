import { inject, injectable } from 'inversify';
import IAppSettingDB from '../db/IAppSettingDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IConfigOverlayLoader from './IConfigOverlayLoader';

/**
 * GUI から編集された config の差分を DB から読み込んで適用する。
 * Operator / Service / EPGUpdater の各プロセスが起動時に呼び、
 * 設定更新時にも再度呼ばれる (再起動が要らない項目をその場で反映するため)
 */
@injectable()
export default class ConfigOverlayLoader implements IConfigOverlayLoader {
    // app_setting のトップレベルキー
    public static readonly SETTING_KEY = 'config';

    private log: ILogger;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('IAppSettingDB') private db: IAppSettingDB,
    ) {
        this.log = logger.getLogger();
    }

    public async load(): Promise<void> {
        let overlay: unknown;
        try {
            const settings = await this.db.getAll();
            overlay = settings[ConfigOverlayLoader.SETTING_KEY];
        } catch (err) {
            // DB 未接続などで読めなくても config.yml のまま動作を継続する
            return;
        }

        this.configuration.setOverlay(overlay);
        const keys = Object.keys(this.configuration.getOverlay());
        if (keys.length > 0) {
            this.log.system.info(`config overlay applied: ${keys.join(', ')}`);
        }
    }
}
