import * as apid from '../../../../../api';

/**
 * in-memory HLS 配信用のパート情報 (LL-HLS の #EXT-X-PART に対応する)
 */
export interface HLSMemoryPart {
    // 所属セグメント内での連番 (0 始まり)
    index: number;
    // moof + mdat (先頭に emsg を含む場合がある) のバイト列
    data: Buffer;
    // 継続時間 (秒)
    duration: number;
    // 単独でデコードを開始できるか (セグメント先頭パート = キーフレーム始まり)
    isIndependent: boolean;
}

/**
 * in-memory HLS 配信用のセグメント情報
 */
export interface HLSMemorySegment {
    // セグメント番号 (単調増加)
    seq: number;
    // セグメントのバイト列 (確定済みの場合のみ。未確定セグメントは null)
    data: Buffer | null;
    // 継続時間 (秒)。未確定セグメントは現時点までのパートの合計
    duration: number;
    // セグメントを構成するパート一覧
    parts: HLSMemoryPart[];
    // セグメントが確定済みか (未確定セグメントはパートのみ配信できる)
    complete: boolean;
}

/**
 * in-memory HLS のストア動作モード
 * - live: ライブ配信。短いスライディングウィンドウで最新部分のみ保持する
 * - recorded: 録画済み配信。シークバー上の巻き戻しに応えるため長めに保持する
 */
export type HLSMemoryStoreMode = 'live' | 'recorded';

/**
 * LL-HLS のブロッキングプレイリスト要求 (_HLS_msn / _HLS_part) のパラメータ
 */
export interface HLSPlaylistRequest {
    // 待機対象のメディアシーケンス番号 (_HLS_msn)
    msn?: number;
    // 待機対象のパート番号 (_HLS_part)
    part?: number;
}

/**
 * ライブ / 録画済み HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * DI コンテナに singleton で登録し、ストリーム生成側 (LiveStreamBaseModel /
 * RecordedStreamBaseModel) と配信側 (ServiceServer) で共有する
 */
export default interface IHLSMemoryStoreModel {
    /**
     * streamId 用のエントリを作成する (既存エントリは破棄される)
     * @param streamId: apid.StreamId
     * @param mode?: HLSMemoryStoreMode 省略時は live
     */
    create(streamId: apid.StreamId, mode?: HLSMemoryStoreMode): void;

    /**
     * streamId のエントリが存在するか
     */
    has(streamId: apid.StreamId): boolean;

    /**
     * init セグメント (ftyp + moov) をセットする
     */
    setInit(streamId: apid.StreamId, data: Buffer): void;

    /**
     * パートを追加する (LL-HLS)。セグメントが確定していない間もプレイリストへ載る
     * @param streamId: apid.StreamId
     * @param data: Buffer moof + mdat
     * @param duration: number 継続時間 (秒)
     * @param isIndependent: boolean 単独デコード可能か
     */
    addPart(streamId: apid.StreamId, data: Buffer, duration: number, isIndependent: boolean): void;

    /**
     * 組み立て中のパート列を 1 セグメントとして確定させる
     * addPart を経由せずに呼ばれた場合 (パート未対応の呼び出し) はセグメント全体を 1 パートとして扱う
     * @param streamId: apid.StreamId
     * @param data: Buffer セグメント全体のバイト列
     * @param duration: number 継続時間 (秒)
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
     * LL-HLS のブロッキングプレイリスト要求に応じてメディアプレイリストを返す。
     * 要求された msn / part がまだ生成されていない場合は生成されるまで待機する
     * @param streamId: apid.StreamId
     * @param request: HLSPlaylistRequest
     * @return Promise<string | null> 未準備のまま打ち切った場合は null
     */
    waitForPlaylist(streamId: apid.StreamId, request: HLSPlaylistRequest): Promise<string | null>;

    /**
     * init セグメントを返す。未準備の場合は null
     */
    getInitSegment(streamId: apid.StreamId): Buffer | null;

    /**
     * 指定番号のセグメントを返す。保持範囲外 (破棄済み・未生成) の場合は null
     */
    getSegment(streamId: apid.StreamId, seq: number): Buffer | null;

    /**
     * 指定番号のパートを返す。まだ生成されていない場合は生成されるまで待機する
     * (LL-HLS の #EXT-X-PRELOAD-HINT で先行要求されたパートに応えるため)
     * @param streamId: apid.StreamId
     * @param seq: number セグメント番号
     * @param index: number セグメント内のパート番号
     * @return Promise<Buffer | null> 保持範囲外・打ち切りの場合は null
     */
    getPart(streamId: apid.StreamId, seq: number, index: number): Promise<Buffer | null>;

    /**
     * streamId のエントリを破棄する
     */
    delete(streamId: apid.StreamId): void;
}
