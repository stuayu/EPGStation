import * as stream from 'stream';
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
 * per-stream (配信ごと) に生成するインスタンスであり DI コンテナには登録しない。
 */
export default class EitPresentCollectTransform extends stream.Transform {
    private parser = new EitPresentParser();
    private store: IEitPresentStore;
    private channelId: number;

    constructor(store: IEitPresentStore, channelId: number) {
        super();
        this.store = store;
        this.channelId = channelId;
    }

    public _transform(chunk: Buffer, _encoding: string, next: stream.TransformCallback): void {
        try {
            for (const event of this.parser.write(chunk)) {
                this.store.update(this.channelId, {
                    eventId: event.eventId,
                    startAt: event.startAt,
                    durationSec: event.durationSec,
                    receivedAt: new Date().getTime(),
                    isFollowing: event.isFollowing === true,
                });
            }
        } catch (err: any) {
            // 解析に失敗しても配信は続ける (EIT が読めないだけで映像には影響しない)
        }

        next(null, chunk);
    }
}
