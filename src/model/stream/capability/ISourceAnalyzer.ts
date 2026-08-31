import * as apid from '../../../../api';
import { SourceCapabilities } from './ISourceCapabilities';

export default interface ISourceAnalyzer {
    /** 録画ファイルの映像特性を解析する。 */
    analyzeRecordedFile(videoFileId: apid.VideoFileId): Promise<SourceCapabilities>;
    /** チャンネル種別からライブ映像の初期特性を返す。 */
    analyzeLiveChannel(channelId: apid.ChannelId): Promise<SourceCapabilities>;
}
