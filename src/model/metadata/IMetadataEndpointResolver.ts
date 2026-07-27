// 差し替え可能な外部サービスのエンドポイント種別
export type MetadataEndpointName = 'syobocal' | 'annict' | 'wikidata' | 'fxtwitter' | 'sharedData';

export default interface IMetadataEndpointResolver {
    /**
     * 外部サービスのエンドポイント URL を解決する。
     * 優先順位は DB (設定画面) > config.yml (metadataDefaults.endpoints) > 同梱の既定値。
     * Cloudflare などのキャッシュ/プロキシを手前に置きたい場合に差し替えられるようにしている。
     * 値が http/https の URL として不正な場合は既定値へフォールバックする
     * @param name: MetadataEndpointName
     * @return Promise<string>
     */
    resolve(name: MetadataEndpointName): Promise<string>;
    /**
     * 各エンドポイントの同梱既定値を返す (設定画面のプレースホルダ表示用)
     * @return Readonly<Record<MetadataEndpointName, string>>
     */
    getDefaults(): Readonly<Record<MetadataEndpointName, string>>;
}
