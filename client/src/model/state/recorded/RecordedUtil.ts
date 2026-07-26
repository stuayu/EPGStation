import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import GenreUtil from '../../../util/GenreUtil';
import ChannelNameUtil from '../../../util/ChannelNameUtil';
import IChannelModel from '../../channels/IChannelModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import Util from '../../../util/Util';
import { isFeatureEnabled } from '../../../util/FeatureFlags';
import IRecordedUtil, { RecordedDisplayData } from './IRecordedUtil';

@injectable()
export default class RecordedUtil implements IRecordedUtil {
    private serverConfigModel: IServerConfigModel;
    private channelModel: IChannelModel;

    constructor(@inject('IServerConfigModel') serverConfigModel: IServerConfigModel, @inject('IChannelModel') channelModel: IChannelModel) {
        this.serverConfigModel = serverConfigModel;
        this.channelModel = channelModel;
    }

    public convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData {
        const startAt = DateUtil.getJaDate(new Date(item.startAt));
        const endAt = DateUtil.getJaDate(new Date(item.endAt));
        const result: RecordedDisplayData = {
            display: {
                channelName: ChannelNameUtil.getRecordedChannelName(this.channelModel, item, isHalfWidth),
                name: item.name,
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                shortTime: DateUtil.format(startAt, 'MM/dd(w) hh:mm'),
                duration: Math.floor((item.endAt - item.startAt) / 1000 / 60),
                description: item.description,
                extended: item.extended,
                topThumbnailPath: typeof item.thumbnails === 'undefined' || item.thumbnails.length === 0 ? './img/noimg.png' : `./api/thumbnails/${item.thumbnails[0]}`,
                thumbnails: item.thumbnails,
                videoFiles: item.videoFiles,
                hasDrop: false,
            },
            recordedItem: item,
            isSelected: false,
        };

        // 視聴履歴機能が無効な場合、サーバは videoFiles に watchHistory を一切付与しないため
        // ここでの分岐は既存挙動 (バッジ非表示) を変えない
        const config = this.serverConfigModel.getConfig();
        if (isFeatureEnabled(config, 'watchHistory')) {
            const histories = item.videoFiles?.flatMap(video => video.watchHistory ?? []) ?? [];
            if (histories.length > 0) {
                // 進捗が最も進んでいる履歴を代表として採用する (status は 'unwatched' もありうる)
                const best = histories.sort((a, b) => b.position / b.duration - a.position / a.duration)[0];
                result.display.watchStatus = best.status;
                result.display.watchProgress = Math.min(100, Math.round((best.position / best.duration) * 100));
            } else if ((item.videoFiles?.length ?? 0) > 0) {
                // 視聴可能なファイルはあるが履歴が無い = 未視聴
                result.display.watchStatus = 'unwatched';
            }
        }

        // ストリーミング可能な videoFile を列挙する
        if (typeof result.display.videoFiles !== 'undefined' && config !== null) {
            result.display.canStremingVideoFiles = result.display.videoFiles.filter(v => {
                return (v.type === 'ts' && config.isEnableTSRecordedStream === true) || (v.type === 'encoded' && config.isEnableEncodedRecordedStream === true);
            });

            if (result.display.canStremingVideoFiles.length === 0) {
                delete result.display.canStremingVideoFiles;
            }
        }

        let genres: string | null = null;
        if (typeof item.genre1 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre1, item.subGenre1);
        } else if (typeof item.genre2 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre2, item.subGenre2);
        } else if (typeof item.genre3 !== 'undefined') {
            genres = GenreUtil.getGenres(item.genre3, item.subGenre3);
        }
        if (genres !== null) {
            result.display.genre = genres;
        }

        if (item.isRecording !== true && typeof item.dropLogFile !== 'undefined') {
            let fileSize = 0;
            if (typeof item.videoFiles !== 'undefined') {
                for (const v of item.videoFiles) {
                    fileSize += v.size;
                }
            }
            const fileSizeStr = Util.getFileSizeStr(fileSize);
            result.display.drop = `drop: ${item.dropLogFile.dropCnt}, error: ${item.dropLogFile.errorCnt}, scrambling: ${item.dropLogFile.scramblingCnt} ${fileSizeStr}`;
            result.display.dropSimple = `${item.dropLogFile.dropCnt}/${item.dropLogFile.errorCnt}/${item.dropLogFile.scramblingCnt} ${fileSizeStr}`;

            result.display.hasDrop = item.dropLogFile.dropCnt > 0 || item.dropLogFile.errorCnt > 0 || item.dropLogFile.scramblingCnt > 0;
        }

        return result;
    }
}
