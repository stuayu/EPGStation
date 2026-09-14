import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';

export const ORIGINAL_MPEG2_PROFILE_ID = 'original-mpeg2';

/** MPEG-2 TS を端末変換へ渡すプロファイルの対象素材か判定する。 */
export const isOriginalMpeg2Source = (source: SourceCapabilities): boolean =>
    source.transport === 'mpegts' && source.codec === 'mpeg2';

/**
 * 端末変換用の配信コマンドを生成する。
 * 録画は Range 対応のファイル直配信なので、シークを壊すプロセスを挟まない。
 */
export const createOriginalMpeg2Command = (scope: 'live' | 'recorded', tsreadex?: string): string | undefined =>
    scope === 'recorded' || typeof tsreadex === 'undefined'
        ? undefined
        : '%TSREADEX% -x 18 -n -1 -a 13 -b 7 -c 5 -u 5 -';
