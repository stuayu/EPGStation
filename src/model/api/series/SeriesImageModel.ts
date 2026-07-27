import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import AnnictWork from '../../../db/entities/AnnictWork';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAnnictWorkDB from '../../db/IAnnictWorkDB';
import ISeriesDB from '../../db/ISeriesDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IProviderHttpClient from '../../metadata/IProviderHttpClient';
import IThumbnailDB from '../../db/IThumbnailDB';
import ISeriesImageModel, { SeriesImageFile, SeriesImageInfo } from './ISeriesImageModel';

/**
 * シリーズのアイキャッチ画像を解決し、ローカルキャッシュ経由で配信するモデル。
 *
 * 画像を持つのは Annict の作品辞書のみで、しょぼいカレンダーは画像を提供していない
 * (TitleLookup に画像フィールドが無く、/img/{TID}.jpg も 404)。
 *
 * Annict が返す URL は Annict 自身の CDN ではなく**作品公式サイトの OGP 画像**を指しており
 * (例: https://www.madoka-magica.com/tv/ogp.png)、一部は http:// のため、そのまま
 * クライアントから直リンクすると次の問題が起きる:
 *  - EPGStation を https で運用している場合、http:// の画像が mixed content でブロックされる
 *  - 作品公式サイトへの hotlink になり、閲覧のたびに外部へリクエストが飛ぶ
 *  - 公式サイトのリニューアルで 404 になると表示が壊れる
 * そのためサーバ側で一度だけ取得してディスクにキャッシュし、以降はローカルから配信する。
 */
@injectable()
export default class SeriesImageModel implements ISeriesImageModel {
    // キャッシュの保存先 (data/seriesImage/{annictId}.{ext})
    private static readonly CACHE_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'seriesImage');
    private static readonly FETCH_TIMEOUT_MS = 30 * 1000;
    // 取得を許可する Content-Type と拡張子
    private static readonly ALLOWED_TYPES: Readonly<Record<string, string>> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
    };
    // 想定外に巨大な画像でディスクを圧迫しないための上限
    private static readonly MAX_BYTES = 8 * 1024 * 1024;
    // 取得に失敗した作品を再取得しに行くまでの間隔 (ms)。公式サイト消滅時に毎回叩かない
    private static readonly FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;
    // サムネイル代替を探すときに見る録画の件数
    private static readonly THUMBNAIL_SCAN_LIMIT = 5;

    private log: ILogger;
    // 直近に取得へ失敗した annictId → 失敗時刻
    private failures: Map<number, number> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('IAnnictWorkDB') private annictDB: IAnnictWorkDB,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IThumbnailDB') private thumbnailDB: IThumbnailDB,
    ) {
        this.log = logger.getLogger();
    }

    public async getInfo(seriesId: number): Promise<SeriesImageInfo | null> {
        const info = SeriesImageModel.toInfo(await this.resolveWork(seriesId));
        if (info !== null) return info;
        // Annict に画像が無い/取得元が消えている作品も多いため、録画から生成済みの
        // サムネイルをアイキャッチとして代用する
        return (await this.findThumbnail(seriesId)) === null ? null : { source: 'thumbnail', url: null, copyright: null };
    }

    public async getInfoMap(seriesIds: number[]): Promise<Map<number, SeriesImageInfo>> {
        const result = new Map<number, SeriesImageInfo>();
        if (this.enabled() === false || seriesIds.length === 0) return result;

        for (const seriesId of seriesIds) {
            const info = SeriesImageModel.toInfo(await this.resolveWork(seriesId));
            if (info !== null) result.set(seriesId, info);
        }
        // Annict 画像を持たないシリーズは録画サムネイルで代用する
        // (シリーズごとに問い合わせると N+1 になるため 1 クエリでまとめて引く)
        const rest = seriesIds.filter(x => result.has(x) === false);
        if (rest.length === 0) return result;
        const thumbnails = await this.seriesDB.findThumbnailPaths(rest).catch(() => new Map<number, string>());
        for (const seriesId of rest) {
            if (thumbnails.has(seriesId) === true) {
                result.set(seriesId, { source: 'thumbnail', url: null, copyright: null });
            }
        }
        return result;
    }

    public async getFile(seriesId: number): Promise<SeriesImageFile | null> {
        const work = await this.resolveWork(seriesId);
        if (work !== null && work.imageUrl !== null) {
            const cached = await this.findCached(work.annictId);
            if (cached !== null) return cached;

            const lastFailure = this.failures.get(work.annictId);
            const givenUp =
                typeof lastFailure === 'number' && Date.now() - lastFailure < SeriesImageModel.FAILURE_RETRY_MS;
            const downloaded = givenUp === true ? null : await this.download(work.annictId, work.imageUrl);
            if (downloaded !== null) return downloaded;
        }
        // Annict 側の画像が無い/取得できない場合は録画サムネイルで代用する
        return await this.findThumbnail(seriesId);
    }

    /**
     * シリーズに紐づく録画のサムネイルを 1 件探す。
     * 全録画を舐めると重いので、先頭数件だけ見て見つからなければ諦める
     */
    private async findThumbnail(seriesId: number): Promise<SeriesImageFile | null> {
        if (this.enabled() === false) return null;
        try {
            const rows = await this.seriesDB.listRecorded(seriesId);
            for (const row of rows.slice(0, SeriesImageModel.THUMBNAIL_SCAN_LIMIT)) {
                const thumbnail = await this.thumbnailDB.findByRecordedId(Number(row.recordedId));
                if (thumbnail === null) continue;
                const filePath = path.join(this.config.getConfig().thumbnail, thumbnail.filePath);
                try {
                    await fs.promises.access(filePath, fs.constants.R_OK);
                    return { filePath, contentType: 'image/jpeg' };
                } catch {
                    // ファイルが消えている場合は次の録画を見る
                }
            }
        } catch (err) {
            this.log.system.warn(`series image: failed to resolve thumbnail for seriesId=${seriesId}`);
            this.log.system.warn(err);
        }
        return null;
    }

    /**
     * シリーズに対応する Annict 作品を解決する。
     * annictId が入っていればそれを、無ければ syobocalTid 経由で引く
     */
    private async resolveWork(seriesId: number): Promise<AnnictWork | null> {
        if (this.enabled() === false) return null;
        const series = await this.seriesDB.getSeries(seriesId);
        if (series === null) return null;

        if (series.annictId !== null) {
            const annictId = Number(series.annictId);
            if (Number.isFinite(annictId) === true) {
                const work = await this.annictDB.get(annictId);
                if (work !== null) return work;
            }
        }
        if (series.syobocalTid !== null) return await this.annictDB.findBySyobocalTid(series.syobocalTid);
        return null;
    }

    private static toInfo(work: AnnictWork | null): SeriesImageInfo | null {
        if (work === null || work.imageUrl === null) return null;
        return { source: 'annict', url: work.imageUrl, copyright: work.imageCopyright };
    }

    /**
     * キャッシュ済みのファイルを探す (拡張子は取得時の Content-Type で決まるため総当たりする)
     */
    private async findCached(annictId: number): Promise<SeriesImageFile | null> {
        for (const [contentType, extension] of Object.entries(SeriesImageModel.ALLOWED_TYPES)) {
            const filePath = path.join(SeriesImageModel.CACHE_DIR, `${annictId}${extension}`);
            try {
                await fs.promises.access(filePath, fs.constants.R_OK);
                return { filePath, contentType };
            } catch {
                // 次の拡張子を試す
            }
        }
        return null;
    }

    /**
     * 取得元から画像をダウンロードしてキャッシュへ保存する。
     * 失敗しても例外は投げず null を返す (画像はあくまで装飾なので一覧表示を壊さない)
     */
    private async download(annictId: number, url: string): Promise<SeriesImageFile | null> {
        try {
            const response = await this.http.get(url, {
                timeoutMs: SeriesImageModel.FETCH_TIMEOUT_MS,
                responseType: 'buffer',
            });
            if (response.status >= 400) throw new Error(`HttpStatus:${response.status}`);

            const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
            const extension = SeriesImageModel.ALLOWED_TYPES[contentType];
            if (typeof extension === 'undefined') throw new Error(`UnsupportedContentType:${contentType}`);

            const body = response.buffer ?? Buffer.alloc(0);
            if (body.length === 0) throw new Error('EmptyBody');
            if (body.length > SeriesImageModel.MAX_BYTES) throw new Error(`TooLarge:${body.length}`);

            await fs.promises.mkdir(SeriesImageModel.CACHE_DIR, { recursive: true });
            const filePath = path.join(SeriesImageModel.CACHE_DIR, `${annictId}${extension}`);
            // 取得途中のファイルを配信しないよう一時ファイルへ書いてから差し替える
            const tempPath = `${filePath}.tmp`;
            await fs.promises.writeFile(tempPath, body);
            await fs.promises.rename(tempPath, filePath);

            this.failures.delete(annictId);
            return { filePath, contentType };
        } catch (err) {
            this.failures.set(annictId, Date.now());
            this.log.system.warn(`series image: failed to fetch annictId=${annictId} url=${url}`);
            this.log.system.warn(err);
            return null;
        }
    }

    private enabled(): boolean {
        const config = this.config.getConfig();
        return (
            isFeatureEnabled(config, 'seriesLibrary') === true && isFeatureEnabled(config, 'metadataProviders') === true
        );
    }
}
