/* eslint-disable max-len */
import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISecretCrypto from '../../security/ISecretCrypto';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import {
    MetadataGetOption,
    MetadataSearchContext,
    MetadataSearchResult,
    MetadataWork,
    METADATA_NOT_MODIFIED,
    PushWatchRecordResult,
    WatchStatusForSync,
} from '../IMetadataProvider';
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
    public async search(query: string, context?: MetadataSearchContext): Promise<MetadataSearchResult[]> {
        const token = await this.token();
        if (token === null) return [];
        // context.syobocalTid (前段 syobocal プロバイダーが確定させた TID) がある場合は
        // 件数を増やして取得し、syobocalTid が一致する作品をタイトル一致より優先して一意確定する (§5.5)
        const first = typeof context?.syobocalTid === 'number' ? 50 : 20;
        const data = await this.graphql<{ searchWorks: { nodes: AnnictWork[] } }>(
            token,
            `query SearchWorks($titles: [String!], $first: Int!) { searchWorks(titles: $titles, first: $first) { nodes { annictId title titleKana seasonYear syobocalTid media image { facebookOgImageUrl } } } }`,
            { titles: [query], first },
        );
        const nodes = data.searchWorks?.nodes ?? [];
        if (typeof context?.syobocalTid === 'number') {
            const exact = nodes.find(x => x.syobocalTid === context.syobocalTid);
            if (exact) return [this.searchResult(exact, 1)];
        }
        const normalized = normalizeSeriesTitle(query);
        return nodes.map(x => this.searchResult(x, normalizeSeriesTitle(x.title) === normalized ? 1 : 0.8));
    }
    public async get(
        externalId: string,
        _option?: MetadataGetOption,
    ): Promise<MetadataWork | null | typeof METADATA_NOT_MODIFIED> {
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
    /**
     * 視聴記録の双方向同期 (§5.5)。work (annictId) の episodeNumber 話目に対応する Annict の
     * エピソードを引き当て、createRecord mutation で視聴記録を作成し、あわせて作品ステータス
     * (見てる/見た) を updateStatus mutation で同期する。エピソードが未登録 (Annict 側にまだ
     * 存在しない、遅延放送等) の場合は例外を投げるので、呼び出し側 (キュー) でリトライすること
     */
    public async pushWatchRecord(
        workExternalId: string,
        episodeNumber: number,
        watchStatus: WatchStatusForSync,
    ): Promise<PushWatchRecordResult | null> {
        const token = await this.token();
        if (token === null) return null;
        const annictId = Number(workExternalId);
        const data = await this.graphql<{
            works: {
                nodes: Array<{
                    id: string;
                    episodes?: { nodes?: Array<{ id: string; number?: number; sortNumber?: number }> };
                }>;
            };
        }>(
            token,
            `query WorkEpisodes($annictIds: [Int!]) { works(annictIds: $annictIds, first: 1) { nodes { id episodes(first: 500) { nodes { id number sortNumber } } } } }`,
            { annictIds: [annictId] },
        );
        const work = data.works?.nodes?.[0];
        if (!work) throw new Error('AnnictWorkIsNotFound');
        const episode = (work.episodes?.nodes ?? []).find(x => (x.number ?? x.sortNumber) === episodeNumber);
        if (!episode) throw new Error('AnnictEpisodeIsNotFound');
        const created = await this.graphql<{ createRecord: { record?: { id: string } | null } }>(
            token,
            `mutation CreateRecord($episodeId: ID!) { createRecord(input: { episodeId: $episodeId }) { record { id } } }`,
            { episodeId: episode.id },
        );
        // ステータス同期の失敗は視聴記録作成の成功自体を無効にしない (障害分離)
        await this.graphql(
            token,
            `mutation UpdateStatus($workId: ID!, $state: StatusState!) { updateStatus(input: { workId: $workId, state: $state }) { work { id } } }`,
            { workId: work.id, state: watchStatus === 'watched' ? 'WATCHED' : 'WATCHING' },
        ).catch(() => undefined);
        return { recordId: created.createRecord?.record?.id ?? '' };
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
