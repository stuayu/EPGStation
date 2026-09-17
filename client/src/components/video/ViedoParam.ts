import BaseVide from './BaseVideo';
import type { RecordedStreamingType } from '@/util/StreamingTypeUtil';
import * as apid from '../../../../api';

export type VideoType = 'Normal' | 'RecordedStreaming' | 'LiveHLS' | 'RecordedHLS' | 'LiveMpegTs' | 'OfflineHLS' | 'OfflineOriginalMpeg2' | 'OfflineOriginalHevc';

interface VideoParamBase {
    type: VideoType;
    jikkyoChannelId?: string; // ニコニコ実況の実況チャンネル ID (例: jk1)
    jikkyoStartAt?: number; // 録画開始時刻 (UNIX 時刻・ミリ秒)
    jikkyoEndAt?: number; // 録画終了時刻 (UNIX 時刻・ミリ秒)
}

interface OfflineVideoParamBase extends VideoParamBase {
    durationSeconds: number;
    offlineOriginalFileSize?: number;
    chapters?: apid.VideoChapter[];
    offlineAudioTracks?: apid.VideoAudioTrack[];
    offlineDataBroadcastingVideoFileId?: apid.VideoFileId;
    offlineDataBroadcastingFileSize?: number;
    offlineDataBroadcastingChunkSize?: number;
    offlineDataBroadcastingStartAt?: number;
}

export interface NormalVideoParam extends VideoParamBase {
    type: 'Normal';
    videoFileId?: apid.VideoFileId;
    src: string;
}

export interface OfflineHLSVideoParam extends OfflineVideoParamBase {
    type: 'OfflineHLS';
    src: string;
    playPosition?: number;
}

export interface OfflineOriginalMpeg2Param extends OfflineVideoParamBase {
    type: 'OfflineOriginalMpeg2';
    src: string;
    playPosition?: number;
}

export interface OfflineOriginalHevcParam extends OfflineVideoParamBase {
    type: 'OfflineOriginalHevc';
    src: string;
    playPosition?: number;
}

export interface RecordedStreamingParam extends VideoParamBase {
    type: 'RecordedStreaming';
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    streamingType: RecordedStreamingType;
    mode: number;
    playPosition?: number;
    profile?: string;
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
    playPosition?: number;
    profile?: string;
}

export interface LiveMpegTsVideoParam extends VideoParamBase {
    type: 'LiveMpegTs';
    src: string;
    channelId: apid.ChannelId;
    mode: number;
    directMpeg2?: boolean;
}

export type BaseVideoParam = NormalVideoParam | OfflineHLSVideoParam | OfflineOriginalMpeg2Param | OfflineOriginalHevcParam | RecordedStreamingParam | LiveHLSParam | RecordedHLSParam | LiveMpegTsVideoParam;
