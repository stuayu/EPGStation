import * as apid from '../../../../../api';

/**
 * in-memory HLS 配信用のセグメント情報
 */
export interface HLSMemorySegment {
    // セグメント番号 (単調増加)
    seq: number;
    // セグメントのバイト列 (moof + mdat)
    data: Buffer;
    // 継続時間 (秒)
    duration: number;
}

/**
 * ライブ HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * DI コンテナに singleton で登録し、ストリーム生成側 (LiveStreamBaseModel) と
 * 配信側 (ServiceServer) で共有する
 */
export default interface IHLSMemoryStoreModel {
    /**
     * streamId 用のエントリを作成する (既存エントリは破棄される)
     */
    create(streamId: apid.StreamId): void;

    /**
     * streamId のエントリが存在するか
     */
    has(streamId: apid.StreamId): boolean;

    /**
     * init セグメント (ftyp + moov) をセットする
     */
    setInit(streamId: apid.StreamId, data: Buffer): void;

    /**
     * メディアセグメントを追加する。古いセグメントは自動的に破棄される
     */
    addSegment(streamId: apid.StreamId, data: Buffer, duration: number): void;

    /**
     * 再生開始可能な状態 (init + 最低限のセグメントが揃った) か
     */
    isReady(streamId: apid.StreamId): boolean;

    /**
     * メディアプレイリスト (m3u8) 文字列を生成する。未準備の場合は null
     */
    getPlaylist(streamId: apid.StreamId): string | null;

    /**
     * init セグメントを返す。未準備の場合は null
     */
    getInitSegment(streamId: apid.StreamId): Buffer | null;

    /**
     * 指定番号のセグメントを返す。保持範囲外 (破棄済み・未生成) の場合は null
     */
    getSegment(streamId: apid.StreamId, seq: number): Buffer | null;

    /**
     * streamId のエントリを破棄する
     */
    delete(streamId: apid.StreamId): void;
}
