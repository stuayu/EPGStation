import * as apid from '../../../../../api';
import { StreamContainer } from '../../../IConfigFile';
import IStreamBaseModel from './IStreamBaseModel';

export type LiveStreamModelProvider = () => Promise<ILiveStreamBaseModel>;
export type LiveHLSStreamModelProvider = () => Promise<ILiveStreamBaseModel>;

export interface LiveStreamOption {
    channelId: apid.ChannelId;
    cmd?: string;
    // 再生する音声トラック (省略時は主音声)。cmd の %DUALMONOMODE% / %AUDIOMAP% を置換する
    audioTrack?: apid.AudioTrackSpecifier;
    // 配信コンテナ。ID3 (ARIB 字幕) の挿入位置の判定 (LiveStreamBaseModel) に使う
    container?: StreamContainer;
}

export default interface ILiveStreamBaseModel extends IStreamBaseModel<LiveStreamOption> {
    setOption(option: LiveStreamOption, mode: number): void;
}
