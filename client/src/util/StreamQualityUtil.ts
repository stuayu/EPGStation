import * as apid from '../../../api';
import container from '../model/ModelContainer';
import IServerConfigModel from '../model/serverConfig/IServerConfigModel';

/**
 * サーバー config の視聴設定 (mode) 一覧から
 * DPlayer の画質 (quality) リストを生成するためのユーティリティ
 */
namespace StreamQualityUtil {
    export type LiveStreamingType = 'm2ts' | 'm2tsll' | 'webm' | 'mp4' | 'hls';
    export type RecordedStreamingType = 'webm' | 'mp4' | 'hls';

    /**
     * ライブ配信の視聴設定名一覧を返す
     * @param type: LiveStreamingType 配信種別
     * @return string[] 設定が存在しない場合は空配列
     */
    export const getLiveModeNames = (type: LiveStreamingType): string[] => {
        const ts = container.get<IServerConfigModel>('IServerConfigModel').getConfig()?.streamConfig?.live?.ts;
        if (typeof ts === 'undefined') {
            return [];
        }

        if (type === 'm2ts') {
            return typeof ts.m2ts === 'undefined' ? [] : ts.m2ts.map(param => param.name);
        }

        return ts[type] ?? [];
    };

    /**
     * 録画済み番組配信の視聴設定名一覧を返す
     * @param videoFileType: VideoFileType ビデオファイルの種別
     * @param type: RecordedStreamingType 配信種別
     * @return string[] 設定が存在しない場合は空配列
     */
    export const getRecordedModeNames = (videoFileType: apid.VideoFileType, type: RecordedStreamingType): string[] => {
        const recorded = container.get<IServerConfigModel>('IServerConfigModel').getConfig()?.streamConfig?.recorded;
        if (typeof recorded === 'undefined') {
            return [];
        }

        const config = videoFileType === 'ts' ? recorded.ts : recorded.encoded;

        return typeof config === 'undefined' ? [] : config[type] ?? [];
    };

    /**
     * 設定名一覧から DPlayer の画質リストを生成する
     * url は切り替え時に解決されるため、生成時点では現在再生中の url を仮で設定する
     * @param names: string[] 視聴設定名一覧
     * @param url: string 仮の url
     * @param videoType: string DPlayer の video type
     * @return { name: string; url: string; type: string }[]
     */
    export const createQualityList = (names: string[], url: string, videoType: string): { name: string; url: string; type: string }[] => {
        return names.map(name => {
            return {
                name: name,
                url: url,
                type: videoType,
            };
        });
    };

    /**
     * 設定一覧に存在する mode へ丸める
     * 設定一覧が取得できていない場合は指定された mode をそのまま返す
     * @param names: string[] 視聴設定名一覧
     * @param mode: number
     * @return number
     */
    export const normalizeMode = (names: string[], mode: number): number => {
        if (names.length === 0) {
            return mode;
        }

        return mode >= 0 && mode < names.length ? mode : 0;
    };
}

export default StreamQualityUtil;
