import * as apid from '../../api';
import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';

/** encoded 録画でも TS の ARIB 字幕 reader を起動すべき配信か判定する。 */
export const shouldUseEncodedTsSubtitleReader = (
    videoFileType: apid.VideoFileType,
    container: apid.StreamContainer | undefined,
    source: SourceCapabilities | null,
): boolean => videoFileType === 'encoded' && container === 'hls' && source?.transport === 'mpegts';

/** 録画映像と同じ入力時刻から ARIB 字幕 ES だけを TS へ remux する ffmpeg 引数を作る。 */
export const createRecordedSubtitleReaderArgs = (filePath: string, playPosition: number): string[] => [
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+genpts',
    '-ss',
    String(Math.max(0, playPosition)),
    '-i',
    filePath,
    '-map',
    '0:s:0?',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'mpegts',
    'pipe:1',
];
