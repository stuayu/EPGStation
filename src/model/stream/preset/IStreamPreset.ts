import { StreamContainer } from '../../IConfigFile';
import { HdrKind, SourceClass } from '../capability/ISourceCapabilities';

/**
 * 映像補正の選択。
 */
export type VideoCorrectionMode = 'auto' | 'off' | 'bright';

/**
 * ストリーミング再生用プリセット。
 */
export interface StreamPreset {
    /** プリセット識別子。 */
    id: string;
    /** 日本語表示名。 */
    name: string;
    /** 一般ユーザー向け説明。 */
    description?: string;
    /** 上級者向け詳細。 */
    detail?: string;
    /** 利用対象。 */
    useFor: 'live' | 'recorded' | 'both';
    /** 品質カテゴリ。 */
    quality: 'original' | 'highest' | 'high' | 'balanced' | 'compact';
    /** 通常UIに出す組み込みプリセットか。 */
    builtin: boolean;
    /** 旧形式由来のプリセットか。 */
    legacy?: boolean;
    /** 入力側の適用条件。 */
    sourceConditions?: {
        sourceClass?: SourceClass[];
        hdr?: HdrKind[];
        minHeight?: number;
        maxHeight?: number;
    };
    /** クライアント側の適用条件。 */
    clientConditions?: {
        requireHevc?: boolean;
        requireHevcMain10?: boolean;
        requireHdr?: boolean;
    };
    /** 出力設定。 */
    output: {
        codec?: 'copy' | 'h264' | 'hevc';
        resolution?: 'source' | '2160p' | '1080p' | '720p' | '480p' | '240p';
        bitDepth?: 'source' | 8 | 10;
        frameRate?: 'source' | '30p' | '60p';
        hdrMode?: 'preserve' | 'tone-map' | 'sdr';
        deinterlace?: 'auto' | 'off' | '30p' | '60p';
        videoBitrate?: number;
        audioBitrate?: number;
        container?: StreamContainer;
        /** 映像補正。未指定は自動。 */
        videoCorrection?: VideoCorrectionMode;
    };
}
