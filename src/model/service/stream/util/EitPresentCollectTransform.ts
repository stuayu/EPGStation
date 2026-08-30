import * as stream from 'stream';
import ILogger from '../../../ILogger';
import EitPresentParser from '../../../operator/recording/EitPresentParser';
import IEitPresentStore from './IEitPresentStore';

/**
 * EitPresentCollectTransform
 *
 * 配信中の TS から EIT[p/f] を読み取り、放送局ごとの現在番組 (present) / 次番組 (following) を
 * `IEitPresentStore` へ書き込む pass-through Transform。入力された TS は加工せずそのまま下流へ流す。
 *
 * 放送波から直接読んだ EIT[p/f] は Mirakurun の EPG より確実なため、
 * 受信できている間は放送中番組の判定で優先される (`EitOnAirResolver`)。
 *
 * **`stream.on('data')` で読んではいけない**。生の Mirakurun ストリームに data リスナを付けると
 * flowing モードへ切り替わり、pipe が繋がる前のデータを取りこぼして映像が壊れる。
 * 既存の `BroadcastTimeExtractor` / `BitCollectTransform` と同じくパイプ列へ挟むこと。
 *
 * **EIT[p/f] は相乗りしている全サービス分が流れてくる** (ワンセグ・サブチャンネルを含む)。
 * 視聴しているサービス以外の event を書き込むと本編の情報が上書きされるため、
 * `serviceId` が一致するものだけを採用する。
 *
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
export default class EitPresentCollectTransform extends stream.Transform {
    private parser = new EitPresentParser();
    private store: IEitPresentStore;
    private channelId: number;
    private serviceId: number;
    private log: ILogger | null;
    // 受信できているかをログで追えるようにする (present が変わったときだけ出す)
    private lastLoggedEventId: number | null = null;

    /**
     * @param store: IEitPresentStore 解析結果の保存先
     * @param channelId: number 視聴中の放送局 id
     * @param serviceId: number 視聴中のサービス id (相乗りサービスを弾くために使う)
     * @param log?: ILogger
     */
    constructor(store: IEitPresentStore, channelId: number, serviceId: number, log?: ILogger) {
        super();
        this.store = store;
        this.channelId = channelId;
        this.serviceId = serviceId;
        this.log = log ?? null;
    }

    public _transform(chunk: Buffer, _encoding: string, next: stream.TransformCallback): void {
        try {
            for (const event of this.parser.write(chunk)) {
                // 相乗りサービス (ワンセグ・サブチャンネル) の EIT で本編を上書きしない
                if (event.serviceId !== this.serviceId) {
                    continue;
                }

                const changed = this.store.update(this.channelId, {
                    eventId: event.eventId,
                    startAt: event.startAt,
                    durationSec: event.durationSec,
                    receivedAt: new Date().getTime(),
                    isFollowing: event.isFollowing === true,
                });

                if (
                    changed === true &&
                    event.isFollowing !== true &&
                    this.lastLoggedEventId !== event.eventId &&
                    this.log !== null
                ) {
                    this.lastLoggedEventId = event.eventId;
                    const startAt = event.startAt === null ? 'unknown' : new Date(event.startAt).toISOString();
                    this.log.stream.info(
                        `receive EIT[p/f] present: channelId: ${this.channelId} eventId: ${event.eventId} ` +
                            `startAt: ${startAt} duration: ${event.durationSec === null ? '未定' : `${event.durationSec}s`}`,
                    );
                }
            }
        } catch (err: any) {
            // 解析に失敗しても配信は続ける (EIT が読めないだけで映像には影響しない)
            this.log?.stream.debug(`EIT[p/f] parse error: ${err?.message ?? err}`);
        }

        next(null, chunk);
    }
}
