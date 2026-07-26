/* eslint-disable max-len */
import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISecretCrypto from '../../security/ISecretCrypto';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import { MetadataSearchContext, MetadataSearchResult, MetadataWork } from '../IMetadataProvider';
import IProviderHttpClient from '../IProviderHttpClient';
import IAnnictProvider from './IAnnictProvider';
interface GraphQLResult<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}
interface AnnictWork {
    annictId?: number;
    id?: string;
    title: string;
    titleKana?: string;
    seasonYear?: number;
    syobocalTid?: number;
    media?: string;
    image?: { facebookOgImageUrl?: string };
    episodes?: { nodes?: Array<{ number?: number; sortNumber?: number; title?: string; airedAt?: string }> };
}
@injectable()
export default class AnnictProvider implements IAnnictProvider {
    public readonly name = 'annict';
    private readonly endpoint = 'https://api.annict.com/graphql';
    constructor(
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
    ) {}
    public async search(query: string, _context?: MetadataSearchContext): Promise<MetadataSearchResult[]> {
        const token = await this.token();
        if (token === null) return [];
        const data = await this.graphql<{ searchWorks: { nodes: AnnictWork[] } }>(
            token,
            `query SearchWorks($titles: [String!]) { searchWorks(titles: $titles, first: 20) { nodes { annictId title titleKana seasonYear syobocalTid media image { facebookOgImageUrl } } } }`,
            { titles: [query] },
        );
        const normalized = normalizeSeriesTitle(query);
        return (data.searchWorks?.nodes ?? []).map(x =>
            this.searchResult(x, normalizeSeriesTitle(x.title) === normalized ? 1 : 0.8),
        );
    }
    public async get(externalId: string): Promise<MetadataWork | null> {
        const token = await this.token();
        if (token === null) return null;
        const id = Number(externalId);
        const data = await this.graphql<{ works: { nodes: AnnictWork[] } }>(
            token,
            `query Work($annictIds: [Int!]) { works(annictIds: $annictIds, first: 1) { nodes { annictId title titleKana seasonYear syobocalTid media image { facebookOgImageUrl } episodes(first: 500) { nodes { number sortNumber title airedAt } } } } }`,
            { annictIds: [id] },
        );
        const work = data.works?.nodes?.[0];
        if (!work) return null;
        return {
            ...this.searchResult(work, 1),
            episodes: (work.episodes?.nodes ?? []).map(x => ({
                number: x.number ?? x.sortNumber ?? null,
                title: x.title,
                airedAt: x.airedAt ? Date.parse(x.airedAt) : undefined,
            })),
            raw: work,
        };
    }
    private searchResult(work: AnnictWork, score: number): MetadataSearchResult {
        return {
            provider: this.name,
            externalId: String(work.annictId ?? work.id),
            title: work.title,
            originalTitle: work.titleKana,
            year: work.seasonYear,
            score,
            imageUrl: work.image?.facebookOgImageUrl,
            syobocalTid: work.syobocalTid,
        };
    }
    private async token(): Promise<string | null> {
        const all = await this.settings.getAll();
        const config = (all.metadata as any)?.annict;
        if (!config?.enabled) return null;
        const value = config.token;
        if (typeof value !== 'string' || value.length === 0) throw new Error('AnnictTokenIsNotConfigured');
        return this.crypto.isEncrypted(value) ? this.crypto.decrypt(value) : value;
    }
    private async graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
        const response = await this.http.post(this.endpoint, JSON.stringify({ query, variables }), {
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            minimumIntervalMs: 500,
        });
        if (response.status === 401 || response.status === 403) throw new Error('AnnictAuthenticationFailed');
        if (response.status >= 400) throw new Error(`AnnictHttpStatus:${response.status}`);
        const result = response.json<GraphQLResult<T>>();
        if (result.errors?.length) throw new Error(`AnnictGraphQLError:${result.errors.map(x => x.message).join(',')}`);
        if (!result.data) throw new Error('AnnictResponseHasNoData');
        return result.data;
    }
}
