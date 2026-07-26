import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import SYOBOCAL_CHANNEL_MAP_DATA, { SyobocalChannelMapEntry } from './SyobocalChannelMapData';

/**
 * しょぼいカレンダー ChID ⇄ Mirakurun networkId/serviceId のマッピング表 (§5.3・§5.4)。
 * 同梱の初期データ (SyobocalChannelMapData) をベースに、config.yml の
 * `metadataChannelMappingPath` で外部 JSON が指定されていれば読み込んでマージする。
 * 外部ファイルの読み込みに失敗した場合 (未設定 / オフライン / 壊れている等) は
 * 同梱データにフォールバックする
 */
@injectable()
export default class SyobocalChannelMap implements ISyobocalChannelMap {
    private log: ILogger;
    private entries: SyobocalChannelMapEntry[] | null = null;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.log = logger.getLogger();
    }

    public find(networkId: number, serviceId: number): SyobocalChannelMapEntry | undefined {
        return this.load().find(x => x.networkId === networkId && x.serviceId === serviceId);
    }

    private load(): SyobocalChannelMapEntry[] {
        if (this.entries !== null) return this.entries;
        const merged = new Map<string, SyobocalChannelMapEntry>();
        for (const entry of SYOBOCAL_CHANNEL_MAP_DATA) merged.set(`${entry.networkId}:${entry.serviceId}`, entry);

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
