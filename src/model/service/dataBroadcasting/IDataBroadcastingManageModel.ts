import type WebSocket from 'ws';
import * as apid from '../../../../api';

/**
 * ライブ視聴のデータ放送ストリームを要求するパラメータ
 */
export interface DataBroadcastingLiveParam {
    type: 'epgStationLive';
    channelId: apid.ChannelId;
    demultiplexServiceId?: number;
}

/**
 * 録画済みファイルのデータ放送ストリームを要求するパラメータ
 */
export interface DataBroadcastingRecordedParam {
    type: 'epgStationRecorded';
    videoFileId: apid.VideoFileId;
    seek?: number;
    demultiplexServiceId?: number;
}

export type DataBroadcastingParam = DataBroadcastingLiveParam | DataBroadcastingRecordedParam;

export default interface IDataBroadcastingManageModel {
    start(ws: WebSocket, param: DataBroadcastingParam): Promise<void>;
}
