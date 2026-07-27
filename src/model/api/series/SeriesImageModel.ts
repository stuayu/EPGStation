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
import IMetadataEndpointResolver from '../../metadata/IMetadataEndpointResolver';
import IProviderHttpClient from '../../metadata/IProviderHttpClient';
import IRecordedDB from '../../db/IRecordedDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IIPCClient from '../../ipc/IIPCClient';
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
    // サムネイル生成を再依頼するまでの間隔 (ms)。生成は ffmpeg を回すので連打させない
    private static readonly THUMBNAIL_REQUEST_INTERVAL_MS = 10 * 60 * 1000;
    // 一覧 1 回の取得で発行するサムネイル生成依頼の上限
    private static readonly THUMBNAIL_REQUEST_PER_CALL = 5;
    // サムネイル代替を探すときに見る録画の件数
    private static readonly THUMBNAIL_SCAN_LIMIT = 5;
    // Annict が持つ Twitter アバター URL (`twitter.com/{account}/profile_image?size=...`)。
    // x.com への移行で認証必須になり、この URL は画像ではなく HTML を返すようになった
    private static readonly TWITTER_PROFILE_IMAGE =
        /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,20})\/profile_image/iu;

    private log: ILogger;
    // 直近に取得へ失敗した annictId → 失敗時刻
    private failures: Map<number, number> = new Map();
    // サムネイル生成を依頼済みのシリーズ ID → 依頼時刻 (生成完了まで何度も依頼しない)
    private thumbnailRequests: Map<number, number> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('IAnnictWorkDB') private annictDB: IAnnictWorkDB,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IThumbnailDB') private thumbnailDB: IThumbnailDB,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('IIPCClient') private ipc: IIPCClient,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
    ) {
        this.log = logger.getLogger();
    }

    public async getInfo(seriesId: number): Promise<SeriesImageInfo | null> {
        const info = SeriesImageModel.toInfo(await this.resolveWork(seriesId));
        if (info !== null) return info;
        // Annict に画像が無い/取得元が消えている作品も多いため、録画から生成済みの
        // サムネイルをアイキャッチとして代用する
        return (await this.findThumbnail(seriesId)) === null
            ? null
            : { source: 'thumbnail', url: null, copyright: null };
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
        const missing: number[] = [];
        for (const seriesId of rest) {
            if (thumbnails.has(seriesId) === true) {
                result.set(seriesId, { source: 'thumbnail', url: null, copyright: null });
            } else {
                missing.push(seriesId);
            }
        }

        // 画像がまったく無いシリーズは録画ファイルからサムネイルを生成させる。
        // 一覧を開くたびに大量の ffmpeg を起動しないよう 1 回の呼び出しあたりの依頼数を絞り、
        // ページを開くたびに少しずつ埋まっていくようにする
        for (const seriesId of missing.slice(0, SeriesImageModel.THUMBNAIL_REQUEST_PER_CALL)) {
            void this.requestThumbnail(seriesId);
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
        const thumbnail = await this.findThumbnail(seriesId);
        if (thumbnail !== null) return thumbnail;

        // どこからも画像が取れない場合は、録画ファイルからサムネイルを生成するよう依頼する。
        // 生成は Operator プロセスのキューで非同期に走るため、この回は画像なし (404) を返し、
        // 次回以降の表示で生成済みのサムネイルが使われる
        void this.requestThumbnail(seriesId);
        return null;
    }

    /**
     * シリーズに紐づく録画の動画ファイルからサムネイル生成を依頼する (Operator へ IPC)。
     * 生成は ffmpeg を回すため、同じシリーズへの依頼は一定間隔まで抑制する
     */
    private async requestThumbnail(seriesId: number): Promise<void> {
        const requestedAt = this.thumbnailRequests.get(seriesId);
        if (
            typeof requestedAt === 'number' &&
            Date.now() - requestedAt < SeriesImageModel.THUMBNAIL_REQUEST_INTERVAL_MS
        ) {
            return;
        }
        this.thumbnailRequests.set(seriesId, Date.now());
        try {
            const rows = await this.seriesDB.listRecorded(seriesId);
            for (const row of rows.slice(0, SeriesImageModel.THUMBNAIL_SCAN_LIMIT)) {
                const recorded = await this.recordedDB.findId(Number(row.recordedId));
                const videoFile = (recorded?.videoFiles ?? []).find(x => x.type === 'ts') ?? recorded?.videoFiles?.[0];
                if (typeof videoFile === 'undefined') continue;
                this.log.system.info(
                    `series image: request thumbnail generation seriesId=${seriesId} videoFileId=${videoFile.id}`,
                );
                await this.ipc.thumbnail.add(videoFile.id);
                return;
            }
        } catch (err) {
            this.log.system.warn(`series image: failed to request thumbnail for seriesId=${seriesId}`);
            this.log.system.warn(err);
        }
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
        // Twitter アバターはそのままでは取れないので候補 URL へ解決する。
        // 解決できなければ元 URL は HTML しか返さないと分かっているので取得を試みない
        const candidates = SeriesImageModel.TWITTER_PROFILE_IMAGE.test(url)
            ? await this.resolveTwitterAvatar(url)
            : [url];
        if (candidates.length === 0) {
            this.failures.set(annictId, Date.now());
            return null;
        }
        for (const candidate of candidates) {
            const file = await this.fetchInto(annictId, candidate);
            if (file !== null) return file;
        }
        return null;
    }

    /**
     * 1 つの URL から画像を取得してキャッシュへ保存する
     */
    private async fetchInto(annictId: number, target: string): Promise<SeriesImageFile | null> {
        try {
            const response = await this.http.get(target, {
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
            this.log.system.warn(`series image: failed to fetch annictId=${annictId} url=${target}`);
            this.log.system.warn(err);
            return null;
        }
    }

    /**
     * Twitter アバター URL (`twitter.com/{account}/profile_image`) を、実際に画像を返す
     * URL の候補列へ解決する。x.com への移行でこの URL 自体は HTML しか返さなくなったため、
     * fxtwitter の JSON API から `avatar_url` を得る。
     * アカウント削除等で解決できない場合は空配列を返す
     * @param url: string Annict が返した URL
     * @return Promise<string[]> 取得を試す URL (画質の高い順)
     */
    private async resolveTwitterAvatar(url: string): Promise<string[]> {
        const matched = url.match(SeriesImageModel.TWITTER_PROFILE_IMAGE);
        if (matched === null) return [];
        try {
            const api = await this.endpoints.resolve('fxtwitter');
            const response = await this.http.get(`${api.endsWith('/') ? api : `${api}/`}${matched[1]}`, {
                timeoutMs: SeriesImageModel.FETCH_TIMEOUT_MS,
            });
            if (response.status >= 400) return [];
            // アカウント削除時は HTTP 200 で { code: 404 } が返るため body 側も見る
            const body = response.json<{ code?: number; user?: { avatar_url?: string } }>();
            if (typeof body?.code === 'number' && body.code >= 400) return [];
            const avatar = body?.user?.avatar_url;
            if (typeof avatar !== 'string' || /^https?:\/\//iu.test(avatar) === false) return [];

            // 既定の _normal は 48px でアイキャッチには小さすぎるため 400x400 を優先し、
            // その版が無いアカウントに備えて元の URL もフォールバックとして残す
            const larger = avatar.replace(/_normal(\.[a-z]+)$/iu, '_400x400$1');
            return larger === avatar ? [avatar] : [larger, avatar];
        } catch {
            return [];
        }
    }

    private enabled(): boolean {
        const config = this.config.getConfig();
        return (
            isFeatureEnabled(config, 'seriesLibrary') === true && isFeatureEnabled(config, 'metadataProviders') === true
        );
    }
}
