import * as apid from '../../../../api';
import BaseVide from './BaseVideo';

export type VideoType = 'Normal' | 'RecordedStreaming' | 'LiveHLS' | 'RecordedHLS' | 'LiveMpegTs';

interface VideoParamBase {
    type: VideoType;
    jikkyoChannelId?: string; // ニコニコ実況の実況チャンネル ID (例: jk1)
    jikkyoStartAt?: number; // 録画開始時刻 (UNIX 時刻・ミリ秒)
    jikkyoEndAt?: number; // 録画終了時刻 (UNIX 時刻・ミリ秒)
}

export interface NormalVideoParam extends VideoParamBase {
    type: 'Normal';
    src: string;
}

export interface RecordedStreamingParam extends VideoParamBase {
    type: 'RecordedStreaming';
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    streamingType: string;
    mode: number;
}

export interface LiveHLSParam extends VideoParamBase {
    type: 'LiveHLS';
    channelId: apid.ChannelId;
    mode: number;
}

export interface RecordedHLSParam extends VideoParamBase {
    type: 'RecordedHLS';
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    mode: number;
}

export interface LiveMpegTsVideoParam extends VideoParamBase {
    type: 'LiveMpegTs';
    src: string;
}

export type BaseVideoParam = NormalVideoParam | RecordedStreamingParam | LiveHLSParam | RecordedHLSParam | LiveMpegTsVideoParam;
