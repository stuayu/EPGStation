import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';

export default interface IVideoFileTsInfoDB {
    upsert(info: VideoFileTsInfo): Promise<void>;
    findId(videoFileId: apid.VideoFileId): Promise<VideoFileTsInfo | null>;
    findRecordedId(recordedId: apid.RecordedId): Promise<VideoFileTsInfo | null>;
    /**
     * 録画 ID の一覧に対応する TS 解析結果の放送局名 (SDT の serviceName) をまとめて引く。
     * 一覧表示の放送局名に使うので N+1 にならないよう 1 クエリで取得する
     * @param recordedIds: apid.RecordedId[]
     * @return Promise<Map<apid.RecordedId, string>> 解析結果が無い / 局名が空の録画は含まれない
     */
    findServiceNamesByRecordedIds(recordedIds: apid.RecordedId[]): Promise<Map<apid.RecordedId, string>>;
    findWithoutTsInfo(limit: number, offset?: number): Promise<VideoFile[]>;
    findAnalyzedVideoFileIds(limit: number, offset: number): Promise<apid.VideoFileId[]>;
    countAnalyzed(): Promise<number>;
    countWithoutTsInfo(): Promise<number>;
    countAnalyzableVideoFiles(): Promise<number>;
    findAllAnalyzable(limit: number, offset: number): Promise<VideoFile[]>;
    deleteVideoFileId(videoFileId: apid.VideoFileId): Promise<void>;
}
