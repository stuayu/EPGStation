import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISharedDataFetcher from '../ISharedDataFetcher';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import SYOBOCAL_CHANNEL_MAP_DATA, { SyobocalChannelMapEntry } from './SyobocalChannelMapData';

/**
 * しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 (§5.3・§5.4)。
 * 優先度の低い順に「同梱の初期データ (SyobocalChannelMapData)」→「GitHub 等から自動取得した
 * 共有静的データ (§5.1, ISharedDataFetcher、ローカルキャッシュ経由でオフライン時もフォールバック
 * 可能)」→「config.yml の metadataChannelMappingPath で指定したローカル JSON (明示的な
 * 手元上書き)」の順にマージする。いずれの取得元も失敗した場合は同梱データのみで動作する
 */
@injectable()
export default class SyobocalChannelMap implements ISyobocalChannelMap {
    private log: ILogger;
    private entries: SyobocalChannelMapEntry[] | null = null;
    private remoteEntries: SyobocalChannelMapEntry[] = [];

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISharedDataFetcher') private sharedData: ISharedDataFetcher,
    ) {
        this.log = logger.getLogger();
        this.sharedData.startAutoUpdate(payload => {
            if (!Array.isArray(payload.channelMap)) return;
            this.remoteEntries = payload.channelMap
                .filter(x => typeof x.networkId === 'number' && typeof x.serviceId === 'number' && typeof x.chId === 'number')
                .map(x => ({ chId: x.chId, networkId: x.networkId, serviceId: x.serviceId, syobocal: x.syobocal !== false }));
            // 次回参照時に再マージさせる
            this.entries = null;
        });
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
        this.entries = [...merged.values()];
        return this.entries;
    }
}
