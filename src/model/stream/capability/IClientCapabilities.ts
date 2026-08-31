/**
 * 再生クライアントの能力情報。
 */
export interface ClientCapabilities {
    /** HEVC Main の再生対応。 */
    hevc: boolean;
    /** HEVC Main10 の再生対応。 */
    hevcMain10: boolean;
    /** H.264 の再生対応。 */
    h264: boolean;
    /** AV1 の再生対応。 */
    av1?: boolean;
    /** HDR 表示対応。 */
    hdr: boolean;
    /** HLG 表示対応。 */
    hlg: boolean;
    /** 画面幅。 */
    screenWidth?: number;
    /** 画面高さ。 */
    screenHeight?: number;
    /** ハードウェアデコード対応。 */
    hardwareDecode?: boolean;
    /** ネットワーク状態。 */
    network?: 'fast' | 'slow' | 'cellular' | 'unknown';
}
