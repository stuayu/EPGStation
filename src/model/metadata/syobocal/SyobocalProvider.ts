import { inject, injectable } from 'inversify';
import { resolveBoolean } from '../../AppSettingResolver';
import IAppSettingDB from '../../db/IAppSettingDB';
import IChannelDB from '../../db/IChannelDB';
import IConfiguration from '../../IConfiguration';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import {
    MetadataGetOption,
    MetadataSearchContext,
    MetadataSearchResult,
    MetadataWork,
    METADATA_NOT_MODIFIED,
} from '../IMetadataProvider';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalChannelMap from './ISyobocalChannelMap';
import ISyobocalProvider from './ISyobocalProvider';
import { parseSyobocalDate, xmlItems } from './SyobocalXml';

@injectable()
export default class SyobocalProvider implements ISyobocalProvider {
    // 確定系マッチで放送開始時刻の許容誤差 (ms)。EPG のタイムスタンプの丸め誤差を吸収する
    private static readonly CONFIRMED_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

    public readonly name = 'syobocal';
    constructor(
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IChannelDB') private channels: IChannelDB,
        @inject('ISyobocalChannelMap') private channelMap: ISyobocalChannelMap,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
    ) {}

    /**
     * タイトル文字列検索 + (context が放送局/時刻を含む場合) 確定系マッチを行う。
     * 確定系マッチが成立した場合はその結果を score 1 で先頭に置く (§5.4)
     */
    public async search(query: string, context?: MetadataSearchContext): Promise<MetadataSearchResult[]> {
        if (!(await this.enabled())) return [];
        const confirmed = await this.tryConfirmedMatch(context);
        const xml = (await this.http.get(await this.url('TitleLookup', { Title: query }))).text;
        const normalized = normalizeSeriesTitle(query);
        const textResults = xmlItems(xml, 'TitleItem')
            .map(row => {
                const title = row.Title ?? row.ShortTitle ?? '';
                return {
                    provider: this.name,
                    externalId: row.TID,
                    title,
                    originalTitle: row.TitleYomi,
                    year: this.year(row.FirstYear),
                    score: normalizeSeriesTitle(title) === normalized ? 1 : 0.75,
                };
            })
            .filter(x => Boolean(x.externalId && x.title));
        if (!confirmed) return textResults;
        return [confirmed, ...textResults.filter(x => x.externalId !== confirmed.externalId)];
    }

    public async get(
        externalId: string,
        _option?: MetadataGetOption,
    ): Promise<MetadataWork | null | typeof METADATA_NOT_MODIFIED> {
        if (!(await this.enabled())) return null;
        const [titleXml, programXml] = await Promise.all([
            this.http.get(await this.url('TitleLookup', { TID: externalId })).then(x => x.text),
            this.http.get(await this.url('ProgLookup', { TID: externalId })).then(x => x.text),
        ]);
        const row = xmlItems(titleXml, 'TitleItem')[0];
        if (!row) return null;
        const programs = xmlItems(programXml, 'ProgItem');
        return {
            provider: this.name,
            externalId,
            title: row.Title ?? '',
            originalTitle: row.TitleYomi,
            year: this.year(row.FirstYear),
            score: 1,
            description: row.Comment,
            episodes: programs.map(x => ({
                number: this.number(x.Count),
                title: x.SubTitle,
                airedAt: parseSyobocalDate(x.StTime),
            })),
            raw: { coverage: programs.length === 0 ? 'title-only' : 'programs', programCount: programs.length },
        };
    }

    /**
     * ChID + 放送開始時刻から ProgLookup で PID → TID を確定する確定系マッチ (§5.3・§5.4)。
     * - context に channelId/startAt が無い、または局が同梱/外部マッピング表に無い場合は null
     * - 未登録局フラグ (syobocal: false) の局は ProgLookup を最初から呼ばずスキップする
     */
    private async tryConfirmedMatch(context?: MetadataSearchContext): Promise<MetadataSearchResult | null> {
        if (typeof context?.channelId !== 'number' || typeof context?.startAt !== 'number') return null;
        const channel = await this.channels.findId(context.channelId);
        if (!channel) return null;
        const mapping = this.channelMap.find(channel.networkId, channel.serviceId);
        if (!mapping || !mapping.syobocal) return null;
        const progXml = (await this.http.get(await this.url('ProgLookup', { ChID: String(mapping.chId) }))).text;
        const items = xmlItems(progXml, 'ProgItem');
        const hit = items.find(row => {
            const startedAt = parseSyobocalDate(row.StTime);
            return (
                typeof startedAt === 'number' &&
                Math.abs(startedAt - context.startAt!) <= SyobocalProvider.CONFIRMED_MATCH_TOLERANCE_MS
            );
        });
        if (!hit?.TID) return null;
        const titleXml = (await this.http.get(await this.url('TitleLookup', { TID: hit.TID }))).text;
        const row = xmlItems(titleXml, 'TitleItem')[0];
        if (!row) return null;
        return {
            provider: this.name,
            externalId: hit.TID,
            title: row.Title ?? row.ShortTitle ?? '',
            originalTitle: row.TitleYomi,
            year: this.year(row.FirstYear),
            score: 1,
        };
    }

    private async enabled(): Promise<boolean> {
        const all = await this.settings.getAll();
        // 優先順位: DB (設定画面) > config.yml (metadataDefaults) > 既定 (無効) (§6.3)
        return resolveBoolean(
            (all.metadata as any)?.syobocal?.enabled,
            this.config.getConfig().metadataDefaults?.syobocal?.enabled,
            false,
        );
    }
    private async url(command: string, params: Record<string, string>): Promise<string> {
        const query = new URLSearchParams({ Command: command, ...params });
        return `${await this.endpoints.resolve('syobocal')}?${query.toString()}`;
    }
    private number(value?: string): number | null {
        const n = Number(value);
        return value && Number.isFinite(n) ? n : null;
    }
    private year(value?: string): number | undefined {
        const m = value?.match(/\d{4}/);
        return m ? Number(m[0]) : undefined;
    }
}
