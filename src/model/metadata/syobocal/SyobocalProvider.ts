import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import { MetadataSearchContext, MetadataSearchResult, MetadataWork } from '../IMetadataProvider';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalProvider from './ISyobocalProvider';
import { parseSyobocalDate, xmlItems } from './SyobocalXml';
@injectable()
export default class SyobocalProvider implements ISyobocalProvider {
    public readonly name = 'syobocal';
    constructor(
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
    ) {}
    public async search(query: string, _context?: MetadataSearchContext): Promise<MetadataSearchResult[]> {
        if (!(await this.enabled())) return [];
        const xml = (await this.http.get(this.url('TitleLookup', { Title: query }))).text;
        const normalized = normalizeSeriesTitle(query);
        return xmlItems(xml, 'TitleItem')
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
    }
    public async get(externalId: string): Promise<MetadataWork | null> {
        if (!(await this.enabled())) return null;
        const [titleXml, programXml] = await Promise.all([
            this.http.get(this.url('TitleLookup', { TID: externalId })).then(x => x.text),
            this.http.get(this.url('ProgLookup', { TID: externalId })).then(x => x.text),
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
    private async enabled(): Promise<boolean> {
        const all = await this.settings.getAll();
        return Boolean((all.metadata as any)?.syobocal?.enabled);
    }
    private url(command: string, params: Record<string, string>): string {
        const query = new URLSearchParams({ Command: command, ...params });
        return `https://cal.syoboi.jp/db.php?${query.toString()}`;
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
