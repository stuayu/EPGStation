import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import JikkyoUtil from '@/util/JikkyoUtil';
import * as apid from '../../../api';

export interface JikkyoKakologParam {
    jikkyoChannelId: string;
    jikkyoStartAt: number; // 録画ファイルの先頭 (再生位置 0 秒) に対応する実時刻
    jikkyoEndAt: number;
}

export interface JikkyoKakologParamOption {
    recordedApiModel: IRecordedApiModel;
    channelModel: IChannelModel;
    videoApiModel: IVideoApiModel;
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId | null;
}

/**
 * ニコニコ実況の過去ログ取得パラメータを解決する
 *
 * コメントの表示時刻は `jikkyoStartAt + 再生位置` で決まるため、
 * 基準は「番組の開始時刻」ではなく「録画ファイルの先頭に対応する実時刻」
 * (`videoFile.startAt`) でなければ録画マージンの分だけコメントがずれる。
 * 未解析の録画ファイルはメタデータ API 経由でその場で解析させ、
 * それでも取得できない場合のみ番組の開始時刻へフォールバックする。
 *
 * @param option: JikkyoKakologParamOption
 * @return Promise<JikkyoKakologParam | null> 実況チャンネルを解決できない場合は null
 */
export const resolveJikkyoKakologParam = async (option: JikkyoKakologParamOption): Promise<JikkyoKakologParam | null> => {
    try {
        const recorded = await option.recordedApiModel.get(option.recordedId, true);

        let channel = option.channelModel.findChannel(recorded.channelId, true);
        if (channel === null) {
            await option.channelModel.fetchChannels();
            channel = option.channelModel.findChannel(recorded.channelId, true);
        }

        const jikkyoChannelId = channel === null ? null : JikkyoUtil.findJikkyoChannelId(channel);
        if (jikkyoChannelId === null) {
            return null;
        }

        const time = await resolveTime(option, recorded);

        return {
            jikkyoChannelId: jikkyoChannelId,
            jikkyoStartAt: time.startAt,
            jikkyoEndAt: time.endAt,
        };
    } catch (err) {
        console.error(err);

        return null;
    }
};

/**
 * 過去ログの取得範囲を決める
 * @param option: JikkyoKakologParamOption
 * @param recorded: apid.RecordedItem
 * @return Promise<{ startAt: number; endAt: number }>
 */
const resolveTime = async (option: JikkyoKakologParamOption, recorded: apid.RecordedItem): Promise<{ startAt: number; endAt: number }> => {
    const programDuration = Math.max(recorded.endAt - recorded.startAt, 0);
    if (option.videoFileId === null) {
        return { startAt: recorded.startAt, endAt: recorded.endAt };
    }

    // 録画一覧に含まれる実測メタデータ
    const videoFile = typeof recorded.videoFiles === 'undefined' ? undefined : recorded.videoFiles.find(file => file.id === option.videoFileId);
    if (typeof videoFile !== 'undefined' && typeof videoFile.startAt === 'number') {
        return createTime(videoFile.startAt, videoFile.duration, programDuration);
    }

    // 未解析の場合はメタデータ API を叩いてその場で解析させる
    try {
        const metadata = await option.videoApiModel.getMetadata(option.videoFileId);
        if (metadata.startAt !== null) {
            return createTime(metadata.startAt, metadata.duration === null ? undefined : metadata.duration, programDuration);
        }
    } catch (err) {
        console.error(err);
    }

    return { startAt: recorded.startAt, endAt: recorded.endAt };
};

/**
 * 録画ファイル先頭の実時刻と実尺から取得範囲を組み立てる
 * 実尺が不明な場合は番組の長さで代用する
 * @param startAt: number 録画ファイル先頭の実時刻
 * @param duration: number | undefined 実測の動画長 (秒)
 * @param programDuration: number 番組の長さ (ミリ秒)
 * @return { startAt: number; endAt: number }
 */
const createTime = (startAt: number, duration: number | undefined, programDuration: number): { startAt: number; endAt: number } => {
    const length = typeof duration === 'number' && duration > 0 ? Math.round(duration * 1000) : programDuration;

    return { startAt: startAt, endAt: startAt + length };
};
