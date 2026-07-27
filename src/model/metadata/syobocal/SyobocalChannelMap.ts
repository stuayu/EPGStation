import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISharedDataFetcher from '../ISharedDataFetcher';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import SYOBOCAL_CHANNEL_MAP_DATA, { SyobocalChannelMapEntry } from './SyobocalChannelMapData';

/**
 * しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 (§5.3・§5.4・§6.2)。
 * 優先度の低い順に「同梱の初期データ (SyobocalChannelMapData)」→「GitHub 等から自動取得した
 * 共有静的データ (§5.1, ISharedDataFetcher、ローカルキャッシュ経由でオフライン時もフォールバック
 * 可能)」→「config.yml の metadataChannelMappingPath で指定したローカル JSON (明示的な
 * 手元上書き)」→「設定画面 (DB: app_setting.syobocalChannelMap) からの編集」の順にマージする
 * (後段ほど優先度が高い)。いずれの取得元も失敗した場合は同梱データのみで動作する
 */
@injectable()
export default class SyobocalChannelMap implements ISyobocalChannelMap {
    // DB 設定 (設定画面からの編集) を再読み込みする間隔。IPC 等での即時反映は行わないため、
    // 保存後は最大でこの間隔だけ反映が遅れる (録画中の処理には影響しない fire-and-forget)
    private static readonly DB_REFRESH_INTERVAL_MS = 60 * 1000;

    private log: ILogger;
    private entries: SyobocalChannelMapEntry[] | null = null;
    private remoteEntries: SyobocalChannelMapEntry[] = [];
    private dbEntries: SyobocalChannelMapEntry[] = [];
    private dbRefreshTimer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISharedDataFetcher') private sharedData: ISharedDataFetcher,
        @inject('IAppSettingDB') private settingsDB: IAppSettingDB,
    ) {
        this.log = logger.getLogger();
        this.sharedData.startAutoUpdate(payload => {
            if (!Array.isArray(payload.channelMap)) return;
            this.remoteEntries = payload.channelMap
                .filter(
                    x =>
                        typeof x.networkId === 'number' &&
                        typeof x.serviceId === 'number' &&
                        typeof x.chId === 'number',
                )
                .map(x => ({
                    chId: x.chId,
                    networkId: x.networkId,
                    serviceId: x.serviceId,
                    syobocal: x.syobocal !== false,
                }));
            // 次回参照時に再マージさせる
            this.entries = null;
        });
        this.refreshFromDb().catch(() => undefined);
        this.dbRefreshTimer = setInterval(() => {
            this.refreshFromDb().catch(() => undefined);
        }, SyobocalChannelMap.DB_REFRESH_INTERVAL_MS);
        if (typeof this.dbRefreshTimer.unref === 'function') this.dbRefreshTimer.unref();
    }

    /**
     * 設定画面 (DB: app_setting.syobocalChannelMap) からマッピング表を読み込み直す。
     * 保存直後の即時反映のため、AppSettingApiModel からも直接呼べるよう public にしている
     */
    public async refreshFromDb(): Promise<void> {
        const all = await this.settingsDB.getAll();
        const raw = (all as any).syobocalChannelMap;
        if (!Array.isArray(raw)) return;
        this.dbEntries = raw
            .filter(
                x =>
                    typeof x?.networkId === 'number' && typeof x?.serviceId === 'number' && typeof x?.chId === 'number',
            )
            .map(x => ({
                chId: x.chId,
                networkId: x.networkId,
                serviceId: x.serviceId,
                syobocal: x.syobocal !== false,
            }));
        // 次回参照時に再マージさせる
        this.entries = null;
    }

    public find(networkId: number, serviceId: number): SyobocalChannelMapEntry | undefined {
        return this.load().find(x => x.networkId === networkId && x.serviceId === serviceId);
    }

    private load(): SyobocalChannelMapEntry[] {
        if (this.entries !== null) return this.entries;
        const merged = new Map<string, SyobocalChannelMapEntry>();
        for (const entry of SYOBOCAL_CHANNEL_MAP_DATA) merged.set(`${entry.networkId}:${entry.serviceId}`, entry);
        for (const entry of this.remoteEntries) merged.set(`${entry.networkId}:${entry.serviceId}`, entry);

        const path = this.config.getConfig().metadataChannelMappingPath;
        if (typeof path === 'string' && path.length > 0) {
            try {
                const text = fs.readFileSync(path, 'utf-8');
                const parsed = JSON.parse(text) as unknown;
                if (Array.isArray(parsed)) {
                    for (const raw of parsed) {
                        if (
                            raw &&
                            typeof raw.networkId === 'number' &&
                            typeof raw.serviceId === 'number' &&
                            typeof raw.chId === 'number'
                        ) {
                            merged.set(`${raw.networkId}:${raw.serviceId}`, {
                                chId: raw.chId,
                                networkId: raw.networkId,
                                serviceId: raw.serviceId,
                                syobocal: raw.syobocal !== false,
                            });
                        }
                    }
                }
            } catch (e) {
                // オフライン/未設置/壊れたファイル等では同梱データにフォールバックする (graceful degradation)
                this.log.system.warn(`failed to load metadataChannelMappingPath: ${path} (${(e as Error).message})`);
            }
        }
        // 設定画面 (DB) からの編集が最優先 (§6.2)
        for (const entry of this.dbEntries) merged.set(`${entry.networkId}:${entry.serviceId}`, entry);
        this.entries = [...merged.values()];
        return this.entries;
    }
}
