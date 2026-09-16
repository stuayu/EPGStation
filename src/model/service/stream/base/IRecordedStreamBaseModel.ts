import * as apid from '../../../../../api';
import IStreamBaseModel from './IStreamBaseModel';

export type RecordedStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;
export type RecordedHLSStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;

export interface RecordedStreamOption {
    videoFileId: apid.VideoFileId;
    playPosition: number; // 再生位置(秒)
    cmd: string;
    // 配信コンテナ。ARIB 字幕の出力側 ID3 化など、コンテナ依存の処理に使う
    container?: apid.StreamContainer;
    // 再生する音声トラック (省略時は主音声)。cmd の %DUALMONOMODE% / %AUDIOMAP% を置換する
    audioTrack?: apid.AudioTrackSpecifier;
    // 実ファイル probe で得た音声 ES 数。取得失敗時は未指定で従来の挙動に戻す
    audioStreamCount?: number;
    // 録画 HLS の fMP4 完成レコードを直接返すオフライン保存モード
    offline?: boolean;
}

export interface VideoFileInfo {
    duration: number;
    size: number;
    bitRate: number;
    /** 映像 stream の PTS 基準 (秒)。未取得時は 0 */
    startTime?: number;
}

export default interface IRecordedStreamBaseModel extends IStreamBaseModel<RecordedStreamOption> {
    setOption(option: RecordedStreamOption, mode: number): void;
}
