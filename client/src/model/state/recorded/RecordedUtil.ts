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
        const duration = Math.floor((item.endAt - item.startAt) / 1000 / 60);
        const fileDuration = RecordedUtil.getFileDuration(item);
        const result: RecordedDisplayData = {
            display: {
                channelName: ChannelNameUtil.getRecordedChannelName(this.channelModel, item, isHalfWidth),
                name: item.name,
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                shortTime: DateUtil.format(startAt, 'MM/dd(w) hh:mm'),
                duration: duration,
                durationText: RecordedUtil.createDurationText(duration, fileDuration),
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

        if (fileDuration !== null) {
            result.display.fileDuration = fileDuration;
        }

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

        // ジャンルチップ表示用に genre1 ~ genre3 をすべて集約する (重複は除く)
        const genreItems: string[] = [];
        for (const [lv1, lv2] of [
            [item.genre1, item.subGenre1],
            [item.genre2, item.subGenre2],
            [item.genre3, item.subGenre3],
        ] as const) {
            if (typeof lv1 === 'undefined') {
                continue;
            }
            const text = GenreUtil.getGenres(lv1, lv2);
            if (text !== null && genreItems.includes(text) === false) {
                genreItems.push(text);
            }
        }
        if (genreItems.length > 0) {
            result.display.genreItems = genreItems;
        }

        // 録画タグ (色付きチップ表示用)
        if (typeof item.tags !== 'undefined' && item.tags.length > 0) {
            result.display.tags = item.tags;
        }

        // 放送局ロゴ
        const channel = this.channelModel.findChannel(item.channelId, isHalfWidth);
        if (channel !== null && channel.hasLogoData === true) {
            result.display.logoSrc = `./api/channels/${channel.id.toString(10)}/logo`;
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

    /**
     * 録画ファイルの実測の長さ (分) を返す
     * 複数ファイルがある場合は最も長いものを採用する (TS と エンコード済みで尺が異なることがあるため)
     * @param item: apid.RecordedItem
     * @return number | null 未解析でメタデータが無い場合は null
     */
    private static getFileDuration(item: apid.RecordedItem): number | null {
        if (typeof item.videoFiles === 'undefined') {
            return null;
        }

        const durations = item.videoFiles.filter(video => typeof video.duration === 'number' && video.duration > 0).map(video => video.duration as number);

        return durations.length === 0 ? null : Math.round(Math.max(...durations) / 60);
    }

    /**
     * 一覧表示用の長さ文字列を作る
     * 実測の長さが番組の長さと異なる場合のみ併記する
     * @param duration: number 番組の長さ (分)
     * @param fileDuration: number | null 録画ファイルの実測の長さ (分)
     * @return string
     */
    private static createDurationText(duration: number, fileDuration: number | null): string {
        if (fileDuration === null || fileDuration === duration) {
            return `${duration} m`;
        }

        return `${duration} m → 実 ${fileDuration} m`;
    }
}
