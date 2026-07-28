import * as path from 'path';
import { injectable } from 'inversify';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import { EncodeRecordedIdIndex } from '../service/encode/IEncodeManageModel';
import IRecordedItemUtil from './IRecordedItemUtil';

@injectable()
export default class RecordedItemUtil implements IRecordedItemUtil {
    /**
     * Recorded を RecordedItem に変換する
     * @param recorded: Recorded
     * @param isHalfWidth isHalfWidth
     */
    public convertRecordedToRecordedItem(
        recorded: Recorded,
        isHalfWidth: boolean,
        encodeIndex: EncodeRecordedIdIndex = {},
    ): apid.RecordedItem {
        const item: apid.RecordedItem = {
            id: recorded.id,
            channelId: recorded.channelId,
            startAt: recorded.startAt,
            endAt: recorded.endAt,
            name: isHalfWidth === true ? recorded.halfWidthName : recorded.name,
            isRecording: recorded.isRecording,
            isEncoding: typeof encodeIndex[recorded.id] !== 'undefined',
            isProtected: recorded.isProtected,
        };

        // 録画時点の放送局名 (channel テーブルから放送局情報が失われた場合の表示用)
        const channelName = isHalfWidth === true ? recorded.halfWidthChannelName : recorded.channelName;
        if (typeof channelName === 'string' && channelName.length > 0) {
            item.channelName = channelName;
        }

        if (recorded.ruleId !== null) {
            item.ruleId = recorded.ruleId;
        }

        if (recorded.programId !== null) {
            item.programId = recorded.programId;
        }

        if (recorded.description !== null) {
            if (isHalfWidth === true) {
                if (typeof recorded.halfWidthDescription === 'string') {
                    item.description = recorded.halfWidthDescription;
                }
            } else {
                item.description = recorded.description;
            }
        }

        if (recorded.extended !== null) {
            if (isHalfWidth === true) {
                if (typeof recorded.halfWidthExtended === 'string') {
                    item.extended = recorded.halfWidthExtended;
                }
            } else {
                item.extended = recorded.extended;
            }
        }

        if (recorded.rawExtended !== null) {
            if (isHalfWidth === true) {
                if (typeof recorded.rawHalfWidthExtended === 'string') {
                    item.rawExtended = JSON.parse(recorded.rawHalfWidthExtended);
                } else {
                    item.rawExtended = JSON.parse(recorded.rawExtended);
                }
            }
        }

        if (recorded.genre1 !== null) {
            item.genre1 = recorded.genre1;
        }

        if (recorded.subGenre1 !== null) {
            item.subGenre1 = recorded.subGenre1;
        }

        if (recorded.genre2 !== null) {
            item.genre2 = recorded.genre2;
        }

        if (recorded.subGenre2 !== null) {
            item.subGenre2 = recorded.subGenre2;
        }

        if (recorded.genre3 !== null) {
            item.genre3 = recorded.genre3;
        }

        if (recorded.subGenre3 !== null) {
            item.subGenre3 = recorded.subGenre3;
        }

        if (recorded.videoType !== null) {
            item.videoType = <any>recorded.videoType;
        }

        if (recorded.videoResolution !== null) {
            item.videoResolution = <any>recorded.videoResolution;
        }

        if (recorded.videoStreamContent !== null) {
            item.videoStreamContent = recorded.videoStreamContent;
        }

        if (recorded.videoComponentType !== null) {
            item.videoComponentType = recorded.videoComponentType;
        }

        if (recorded.audioSamplingRate !== null) {
            item.audioSamplingRate = <any>recorded.audioSamplingRate;
        }

        if (recorded.audioComponentType !== null) {
            item.audioComponentType = recorded.audioComponentType;
        }

        if (typeof recorded.thumbnails !== 'undefined') {
            item.thumbnails = recorded.thumbnails.map(t => {
                return t.id;
            });
        }

        if (typeof recorded.videoFiles !== 'undefined') {
            item.videoFiles = recorded.videoFiles.map(v => {
                const videoFile: apid.VideoFile = {
                    id: v.id,
                    name: v.name,
                    filename: path.basename(v.filePath),
                    type: v.type as apid.VideoFileType,
                    size: v.size,
                };

                // ffprobe で実測済みのメタデータがあれば返す (シークバー・実況補正用)
                if (v.duration !== null && typeof v.duration !== 'undefined') {
                    videoFile.duration = v.duration;
                }
                if (v.startTime !== null && typeof v.startTime !== 'undefined') {
                    videoFile.startTime = v.startTime;
                }
                if (v.startAt !== null && typeof v.startAt !== 'undefined') {
                    videoFile.startAt = typeof v.startAt === 'string' ? parseInt(v.startAt, 10) : v.startAt;
                }
                if (v.videoCodec !== null && typeof v.videoCodec !== 'undefined') {
                    videoFile.videoCodec = v.videoCodec;
                }
                if (v.audioCodec !== null && typeof v.audioCodec !== 'undefined') {
                    videoFile.audioCodec = v.audioCodec;
                }
                if (v.width !== null && typeof v.width !== 'undefined') {
                    videoFile.width = v.width;
                }
                if (v.height !== null && typeof v.height !== 'undefined') {
                    videoFile.height = v.height;
                }
                if (v.bitRate !== null && typeof v.bitRate !== 'undefined') {
                    videoFile.bitRate = v.bitRate;
                }

                return videoFile;
            });
        }

        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            item.dropLogFile = {
                id: recorded.dropLogFile.id,
                errorCnt: recorded.dropLogFile.errorCnt,
                dropCnt: recorded.dropLogFile.dropCnt,
                scramblingCnt: recorded.dropLogFile.scramblingCnt,
            };
        }

        if (typeof recorded.tags !== 'undefined') {
            item.tags = recorded.tags.map(t => {
                return {
                    id: t.id,
                    name: t.name,
                    color: t.color,
                };
            });
        }

        return item;
    }
}
