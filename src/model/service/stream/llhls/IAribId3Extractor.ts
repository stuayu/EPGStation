import * as stream from 'stream';

/**
 * TS から取り出した ID3 timed metadata (ARIB 字幕由来) 1 件分
 */
export interface AribId3Metadata {
    // PES ヘッダから取り出した PTS (90kHz)
    pts: number;
    // ID3v2 タグのバイト列 (ヘッダ 10 byte + フレーム群、ffmpeg 用パディングやスタッフィングは除去済み)
    payload: Buffer;
}

export default interface IAribId3Extractor extends stream.Transform {
    // ARIB 字幕由来の ID3 timed metadata を検出した際に通知される
    on(event: 'id3', listener: (metadata: AribId3Metadata) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
