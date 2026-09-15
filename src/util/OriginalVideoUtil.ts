import * as apid from '../../api';
import { isOriginalHevcSource } from './OriginalHevcUtil';
import { isOriginalMpeg2Source } from './OriginalMpeg2Util';

export type OriginalVideoKind = 'mpeg2' | 'hevc';

/** Range で元ファイルを直接返せる MPEG-TS の映像 codec を分類する。 */
export const classifyOriginalVideoSource = (source: apid.SourceCapabilities): OriginalVideoKind | undefined => {
    if (isOriginalMpeg2Source(source)) return 'mpeg2';
    if (isOriginalHevcSource(source)) return 'hevc';
    return undefined;
};
