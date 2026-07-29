import * as stream from 'stream';
import { AribId3Metadata } from './IAribId3Extractor';

/**
 * Fmp4Packager が扱うパート (moof + mdat の組) 情報
 */
export interface Fmp4PackagerPart {
    // moof + mdat を連結したバイト列
    data: Buffer;
    // メディアタイムライン上での実継続時間 (秒)
    duration: number;
    // セグメント内で最初のパートかどうか (キーフレーム境界にあたる想定)
    isIndependent: boolean;
}

/**
 * Fmp4Packager が扱うセグメント (複数パートの集合) 情報
 */
export interface Fmp4PackagerSegment {
    // セグメントを構成する全パートのバイト列を連結したもの
    data: Buffer;
    // セグメントの実継続時間 (秒, 各パートの duration 合計)
    duration: number;
    // セグメントを構成するパート一覧
    parts: Fmp4PackagerPart[];
}

/**
 * Fmp4Packager のコンストラクタオプション
 */
export interface Fmp4PackagerOption {
    // 1 セグメントを構成するパート数 (既定 3)
    partsPerSegment?: number;
}

export default interface IFmp4Packager extends stream.Writable {
    /**
     * エンコード前の TS から抜き取った ID3 timed metadata (ARIB 字幕) を登録する
     * 登録された metadata は次に出力するセグメント先頭の emsg box として多重化される
     * @param metadata: AribId3Metadata
     */
    pushId3(metadata: AribId3Metadata): void;

    on(event: 'init', listener: (data: Buffer) => void): this;
    on(event: 'part', listener: (part: Fmp4PackagerPart) => void): this;
    on(event: 'segment', listener: (segment: Fmp4PackagerSegment) => void): this;
    // ストリーム終端で、どの part にも属さない末尾 box (mfra 等) が残っていた場合に通知される
    on(event: 'trailer', listener: (data: Buffer) => void): this;
    // 破損入力等により解析を継続できず打ち切った際に通知される (標準の 'error' は使用しない)
    on(event: 'halted', listener: (message: string) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
