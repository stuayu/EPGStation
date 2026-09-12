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
 * 複数音声トラック分解モードでのトラックの役割 (Fmp4PackagerTrackRole の 'video'/'audio0'/'audio1' に対応)。
 * ファイル名の一部として使うため短い記法にしている
 */
export type HLSMemoryTrackRole = 'v' | 'a0' | 'a1';

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
 * マスタープレイリスト (複数音声レンディション) の 1 音声トラック分の表示情報
 */
export interface HLSMasterAudioTrack {
    role: 'a0' | 'a1';
    // #EXT-X-MEDIA の NAME
    name: string;
    isDefault: boolean;
}

/**
 * ライブ / 録画済み HLS をディスクに書き出さずにメモリ上で保持・配信するためのストア
 * DI コンテナに singleton で登録し、ストリーム生成側 (LiveStreamBaseModel /
 * RecordedStreamBaseModel) と配信側 (ServiceServer) で共有する
 *
 * 複数音声トラック分解モード (Fmp4Packager が 'multiTrack' を検出した場合) では、
 * 映像 (role: 'v') と音声 (role: 'a0' / 'a1') を別々のエントリとして保持する。
 * role を省略した呼び出しは従来どおり単一トラックのエントリを指す (streamId のみがキー)
 */
export default interface IHLSMemoryStoreModel {
    /**
     * streamId (+ role) 用のエントリを作成する (既存エントリは破棄される)
     * @param streamId: apid.StreamId
     * @param mode?: HLSMemoryStoreMode 省略時は live
     * @param role?: HLSMemoryTrackRole 複数音声トラック分解モードのときだけ指定する
     */
    create(streamId: apid.StreamId, mode?: HLSMemoryStoreMode, role?: HLSMemoryTrackRole): void;

    /**
     * streamId (+ role) のエントリが存在するか
     */
    has(streamId: apid.StreamId, role?: HLSMemoryTrackRole): boolean;

    /**
     * init セグメント (ftyp + moov) をセットする
     */
    setInit(streamId: apid.StreamId, data: Buffer, role?: HLSMemoryTrackRole): void;

    /**
     * パートを追加する (LL-HLS)。セグメントが確定していない間もプレイリストへ載る
     * @param streamId: apid.StreamId
     * @param data: Buffer moof + mdat
     * @param duration: number 継続時間 (秒)
     * @param isIndependent: boolean 単独デコード可能か
     * @param role?: HLSMemoryTrackRole
     */
    addPart(
        streamId: apid.StreamId,
        data: Buffer,
        duration: number,
        isIndependent: boolean,
        role?: HLSMemoryTrackRole,
    ): void;

    /**
     * 組み立て中のパート列を 1 セグメントとして確定させる
     * addPart を経由せずに呼ばれた場合 (パート未対応の呼び出し) はセグメント全体を 1 パートとして扱う
     * @param streamId: apid.StreamId
     * @param data: Buffer セグメント全体のバイト列
     * @param duration: number 継続時間 (秒)
     * @param role?: HLSMemoryTrackRole
     */
    addSegment(streamId: apid.StreamId, data: Buffer, duration: number, role?: HLSMemoryTrackRole): void;

    /**
     * 再生開始可能な状態 (init + 最低限のセグメントが揃った) か
     */
    isReady(streamId: apid.StreamId, role?: HLSMemoryTrackRole): boolean;

    /**
     * メディアプレイリスト (m3u8) 文字列を生成する。未準備の場合は null
     */
    getPlaylist(streamId: apid.StreamId, role?: HLSMemoryTrackRole): string | null;

    /**
     * マスタープレイリスト (複数音声レンディション) を生成する。
     * role: 'v' のエントリが未準備の場合は null
     * @param streamId: apid.StreamId
     * @param audioTracks: HLSMasterAudioTrack[] 音声レンディション一覧 (表示順)
     * @return string | null
     */
    getMasterPlaylist(streamId: apid.StreamId, audioTracks: HLSMasterAudioTrack[]): string | null;

    /**
     * LL-HLS のブロッキングプレイリスト要求に応じてメディアプレイリストを返す。
     * 要求された msn / part がまだ生成されていない場合は生成されるまで待機する
     * @param streamId: apid.StreamId
     * @param request: HLSPlaylistRequest
     * @param role?: HLSMemoryTrackRole
     * @return Promise<string | null> 未準備のまま打ち切った場合は null
     */
    waitForPlaylist(
        streamId: apid.StreamId,
        request: HLSPlaylistRequest,
        role?: HLSMemoryTrackRole,
    ): Promise<string | null>;

    /**
     * ブロッキングプレイリスト要求の msn が保持範囲より古いか判定する
     * @param streamId: apid.StreamId
     * @param msn: number 要求されたメディアシーケンス番号
     * @param role?: HLSMemoryTrackRole
     * @return boolean 保持範囲より古い場合は true
     */
    isPlaylistRequestTooOld(streamId: apid.StreamId, msn: number, role?: HLSMemoryTrackRole): boolean;

    /**
     * init セグメントを返す。未準備の場合は null
     */
    getInitSegment(streamId: apid.StreamId, role?: HLSMemoryTrackRole): Buffer | null;

    /**
     * 指定番号のセグメントを返す。保持範囲外 (破棄済み・未生成) の場合は null
     */
    getSegment(streamId: apid.StreamId, seq: number, role?: HLSMemoryTrackRole): Buffer | null;

    /**
     * 指定番号のパートを返す。まだ生成されていない場合は生成されるまで待機する
     * (LL-HLS の #EXT-X-PRELOAD-HINT で先行要求されたパートに応えるため)
     * @param streamId: apid.StreamId
     * @param seq: number セグメント番号
     * @param index: number セグメント内のパート番号
     * @param role?: HLSMemoryTrackRole
     * @return Promise<Buffer | null> 保持範囲外・打ち切りの場合は null
     */
    getPart(streamId: apid.StreamId, seq: number, index: number, role?: HLSMemoryTrackRole): Promise<Buffer | null>;

    /**
     * クライアントが最後に取得したセグメントより、エンコードがどれだけ先行しているかを返す。
     * 録画済み配信でエンコードを再生位置の近くに留める (先行しすぎを防ぐ) ために使う。
     * 複数音声トラック分解モードでは role: 'v' (映像) の値を基準にする
     * (全ロールが同じ moof 周期で確定するため、映像 1 系統で足りる)
     * @param streamId: apid.StreamId
     * @param role?: HLSMemoryTrackRole
     * @return number 先行しているセグメント数 (未取得なら 0)
     */
    getAheadSegmentNum(streamId: apid.StreamId, role?: HLSMemoryTrackRole): number;

    /**
     * エンコードが正常終了し、これ以上セグメントが増えないことを記録する。
     * ストア自体は破棄せず、プレイリストへ #EXT-X-ENDLIST を付けて終端を伝える。
     * 待機中のブロッキング要求 (自然には解決しなくなるため) はここで解決する
     * @param streamId: apid.StreamId
     * @param role?: HLSMemoryTrackRole
     */
    markEnded(streamId: apid.StreamId, role?: HLSMemoryTrackRole): void;

    /**
     * streamId (+ role) のエントリを破棄する
     */
    delete(streamId: apid.StreamId, role?: HLSMemoryTrackRole): void;
}
