import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import GenreUtil from '../../../util/GenreUtil';
import ChannelNameUtil from '../../../util/ChannelNameUtil';
import IChannelModel from '../../channels/IChannelModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import Util from '../../../util/Util';
import { isFeatureEnabled } from '../../../util/FeatureFlags';
import IRecordedUtil, { RecordedDisplayData } from './IRecordedUtil';

@injectable()
export default class RecordedUtil implements IRecordedUtil {
    private serverConfigModel: IServerConfigModel;
    private channelModel: IChannelModel;
    private settingStorageModel: ISettingStorageModel;

    constructor(
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('ISettingStorageModel') settingStorageModel: ISettingStorageModel,
    ) {
        this.serverConfigModel = serverConfigModel;
        this.channelModel = channelModel;
        this.settingStorageModel = settingStorageModel;
    }

    /**
     * 一覧に表示するタイトルを作る。
     * 「辞書のエピソード名を使う」設定が有効で、シリーズ・話数が確定している録画は
     * 「作品名 第N話 サブタイトル」の形にする (録画タイトルに局独自の装飾が入っていても揃う)。
     * 設定が無効な場合と、シリーズが確定していない録画は録画タイトルをそのまま返す
     * @param item: apid.RecordedItem
     * @return string
     */
    private getDisplayName(item: apid.RecordedItem): string {
        if (this.settingStorageModel.tmp.useDictionaryEpisodeTitle === false) return item.name;
        const series = item.series;
        if (typeof series === 'undefined') return item.name;

        const label = series.episodeLabel ?? (series.episodeNumber === null ? '' : `第${series.episodeNumber}話`);
        const title = [series.seriesTitle, label, series.episodeTitle ?? ''].filter(x => x !== '').join(' ');

        return title === '' ? item.name : title;
    }

    public convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData {
        const startAt = DateUtil.getJaDate(new Date(item.startAt));
        const endAt = DateUtil.getJaDate(new Date(item.endAt));
        const duration = Math.floor((item.endAt - item.startAt) / 1000 / 60);
        const displayVideo = RecordedUtil.getDisplayVideoFile(item);
        const fileDuration = RecordedUtil.getFileDuration(displayVideo);
        const result: RecordedDisplayData = {
            display: {
                channelName: ChannelNameUtil.getRecordedChannelName(this.channelModel, item, isHalfWidth),
                name: this.getDisplayName(item),
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                shortTime: DateUtil.format(startAt, 'MM/dd(w) hh:mm'),
                duration: duration,
                durationText: RecordedUtil.createDurationText(duration, fileDuration),
                epgTimeText: `${DateUtil.format(startAt, 'MM/dd(w) hh:mm')} ~ ${DateUtil.format(endAt, 'hh:mm')} (${duration} 分)`,
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

        const recordedTimeText = RecordedUtil.createRecordedTimeText(displayVideo, startAt);
        if (recordedTimeText !== null) {
            result.display.recordedTimeText = recordedTimeText;
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
     * GUI の「実際に録画された時間 / 実尺」の基準にする video file を返す。
     *
     * 以前は duration が最長のファイルを代表としていたが、元 TS と tsreplace 出力が
     * 同じ RecordedItem に共存すると、TS 側の古い startAt を拾ってしまい、解析ログで
     * tsreplace 側の正しい startAt が求まっていても GUI に反映されないことがあった。
     *
     * 実際の再生基準時刻として解析済み startAt を持つファイルを最優先し、その中では
     * tsreplace を含む encoded を優先する。同一条件なら後から生成/登録された id の大きい
     * ファイルを採用する。startAt がまだ無い場合だけ duration を持つファイルへフォールバックする。
     */
    private static getDisplayVideoFile(item: apid.RecordedItem): apid.VideoFile | null {
        if (typeof item.videoFiles === 'undefined' || item.videoFiles.length === 0) {
            return null;
        }

        const score = (video: apid.VideoFile): number => {
            const hasStartAt = typeof video.startAt === 'number';
            const hasDuration = typeof video.duration === 'number' && video.duration > 0;
            if (hasStartAt && video.type === 'encoded') return 4;
            if (hasStartAt) return 3;
            if (hasDuration && video.type === 'encoded') return 2;
            if (hasDuration) return 1;
            return 0;
        };

        return item.videoFiles.reduce((best, current) => {
            const bestScore = score(best);
            const currentScore = score(current);
            if (currentScore !== bestScore) {
                return currentScore > bestScore ? current : best;
            }

            return current.id > best.id ? current : best;
        });
    }

    /**
     * 録画ファイルの実測の長さ (分) を返す
     * @param video: apid.VideoFile | null GUI 表示の基準にするファイル
     * @return number | null 未解析でメタデータが無い場合は null
     */
    private static getFileDuration(video: apid.VideoFile | null): number | null {
        if (video === null || typeof video.duration !== 'number' || video.duration <= 0) {
            return null;
        }

        return Math.round(video.duration / 60);
    }

    /**
     * 詳細画面用に「実際に録画された時間」の文字列を作る
     * ファイル先頭の実時刻 (TS/ffprobe 解析時に記録) がある場合は録画開始〜終了時刻も添える
     * @param video: apid.VideoFile | null GUI 表示の基準にするファイル
     * @param programStartAt: Date 番組の開始日時 (日付を省略できるかの判定に使う)
     * @return string | null 実測メタデータが無い場合は null
     */
    private static createRecordedTimeText(video: apid.VideoFile | null, programStartAt: Date): string | null {
        if (video === null || typeof video.duration !== 'number' || video.duration <= 0) {
            return null;
        }

        const durationSec = video.duration;
        const lengthText = RecordedUtil.createHmsText(durationSec);
        if (typeof video.startAt !== 'number') {
            // 録画開始時刻が分からない場合は長さだけ返す
            return lengthText;
        }

        const start = DateUtil.getJaDate(new Date(video.startAt));
        const end = DateUtil.getJaDate(new Date(video.startAt + Math.round(durationSec * 1000)));
        // 番組の放送日と同じ日なら日付は省略する (1 行目に出ているため)
        const startText = DateUtil.format(start, RecordedUtil.isSameDate(start, programStartAt) ? 'hh:mm:ss' : 'MM/dd(w) hh:mm:ss');
        const endText = DateUtil.format(end, RecordedUtil.isSameDate(end, start) ? 'hh:mm:ss' : 'MM/dd(w) hh:mm:ss');

        return `${startText} ~ ${endText} (${lengthText})`;
    }

    /**
     * 秒を h:mm:ss 表記にする
     * @param sec: number 秒
     * @return string
     */
    private static createHmsText(sec: number): string {
        const total = Math.round(sec);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;

        return `${hours}:${`0${minutes}`.slice(-2)}:${`0${seconds}`.slice(-2)}`;
    }

    /**
     * 2 つの日時が同じ日か
     */
    private static isSameDate(a: Date, b: Date): boolean {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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
