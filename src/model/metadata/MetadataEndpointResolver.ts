import { inject, injectable } from 'inversify';
import IAppSettingDB from '../db/IAppSettingDB';
import IConfiguration from '../IConfiguration';
import IMetadataEndpointResolver, { MetadataEndpointName } from './IMetadataEndpointResolver';

/**
 * 外部サービスのエンドポイント URL を「DB (設定画面) > config.yml > 同梱既定値」の
 * 優先順位で解決する (§6.3 と同じ方針)。
 *
 * Cloudflare Workers などのキャッシュ/プロキシを手前に置いて運用したい場合に、
 * 各サービスの URL を画面から差し替えられるようにするためのもの。
 * 差し替え後も呼び出し側はパス・クエリの組み立て方を変えないため、
 * プロキシ側は元サービスと同じインターフェースを保つ必要がある。
 */
@injectable()
export default class MetadataEndpointResolver implements IMetadataEndpointResolver {
    private static readonly DEFAULTS: Readonly<Record<MetadataEndpointName, string>> = Object.freeze({
        // しょぼいカレンダーの DB API (TitleLookup / ProgLookup)
        syobocal: 'https://cal.syoboi.jp/db.php',
        // Annict の GraphQL API
        annict: 'https://api.annict.com/graphql',
        // Wikidata の SPARQL エンドポイント (全ジャンルのテレビ番組辞書)
        wikidata: 'https://query.wikidata.org/sparql',
        // Twitter アバターを解決するための fxtwitter の JSON API (末尾にアカウント名を連結する)
        fxtwitter: 'https://api.fxtwitter.com/',
        // 共有静的データ (チャンネルマッピング表等)。既定は未設定 = 取得しない
        sharedData: '',
    });

    constructor(
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IConfiguration') private config: IConfiguration,
    ) {}

    public async resolve(name: MetadataEndpointName): Promise<string> {
        const all = await this.settings.getAll().catch(() => ({}) as Record<string, unknown>);
        const fromDB = (all.metadata as any)?.endpoints?.[name];
        const configDefaults = this.config.getConfig().metadataDefaults?.endpoints;
        const fromConfig =
            name === 'sharedData'
                ? // 共有静的データの URL は従来 metadataSharedDataUrl として定義されているため互換を保つ
                  (configDefaults?.sharedData ?? this.config.getConfig().metadataSharedDataUrl)
                : configDefaults?.[name];

        for (const value of [fromDB, fromConfig]) {
            const url = MetadataEndpointResolver.normalize(value);
            if (url !== null) return url;
        }
        return MetadataEndpointResolver.DEFAULTS[name];
    }

    public getDefaults(): Readonly<Record<MetadataEndpointName, string>> {
        return MetadataEndpointResolver.DEFAULTS;
    }

    /**
     * 設定値を URL として検証する。http/https 以外や URL として解釈できない値は採用しない
     * (file:// などを指定されて意図しないスキームへアクセスするのを防ぐ)
     */
    private static normalize(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (trimmed === '') return null;
        try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            return trimmed;
        } catch {
            return null;
        }
    }
}
