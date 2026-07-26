import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IAppSettingChangeEvent from './IAppSettingChangeEvent';

/**
 * システム設定 (app_setting) の変更を Operator プロセス内へ伝播するためのイベント (§6.3)。
 * Service プロセスでの更新は IPCServer 経由でこのイベントに変換される。
 * 各モジュールは DB の設定値を都度読み直す実装になっているため、多くの場合は
 * 明示的な再初期化処理は不要だが、将来的にキャッシュ等を持つモジュールが増えた場合の
 * フック地点として用意する (録画中の処理には一切影響させない)
 */
@injectable()
class AppSettingChangeEvent implements IAppSettingChangeEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * 設定変更イベント発行
     * @param keys: 変更されたトップレベルキーの一覧
     */
    public emitChanged(keys: string[]): void {
        this.emitter.emit(AppSettingChangeEvent.CHANGED_EVENT, keys);
    }

    /**
     * 設定変更イベント登録
     * @param callback: (keys: string[]) => void
     */
    public setChanged(callback: (keys: string[]) => void): void {
        this.emitter.on(AppSettingChangeEvent.CHANGED_EVENT, async (keys: string[]) => {
            try {
                await callback(keys);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace AppSettingChangeEvent {
    export const CHANGED_EVENT = 'changed';
}

export default AppSettingChangeEvent;
