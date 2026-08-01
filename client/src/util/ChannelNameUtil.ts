import * as apid from '../../../api';
import IChannelModel from '../model/channels/IChannelModel';

/**
 * 放送局名の表示用ユーティリティ
 */
namespace ChannelNameUtil {
    /**
     * 放送局名の解決に必要な最小限の情報
     * (apid.RecordedItem / apid.RecordedItem 相当のオブジェクトを受け取る)
     */
    export interface ChannelNameSource {
        channelId: apid.ChannelId;
        channelName?: string; // 録画時点の放送局名
        tsChannelName?: string; // TS 解析 (SDT) で読み取った放送局名
    }

    /**
     * 録画番組の放送局名を返す
     *
     * 実際に録画されたストリームに入っていた名前 (TS の SDT) を最優先で使う。
     * 転居などで現在の channel 情報から放送局が引けなくなっても表示名が壊れないように、
     * 以下の順で解決する
     * 1. TS 解析で読み取った放送局名 (録画されたストリーム自身が名乗っている名前)
     * 2. 現在の放送局情報 (半角表示設定が反映される)
     * 3. 録画時点に保存された放送局名
     * 4. networkId / serviceId 表記 (最後の手段)
     * @param channelModel: IChannelModel
     * @param item: ChannelNameSource
     * @param isHalfWidth: boolean 半角文字で取得するか
     * @return string
     */
    export const getRecordedChannelName = (channelModel: IChannelModel, item: ChannelNameSource, isHalfWidth: boolean): string => {
        if (typeof item.tsChannelName === 'string' && item.tsChannelName.length > 0) {
            return item.tsChannelName;
        }

        const channel = channelModel.findChannel(item.channelId, isHalfWidth);
        if (channel !== null) {
            return channel.name;
        }

        if (typeof item.channelName === 'string' && item.channelName.length > 0) {
            return item.channelName;
        }

        return getUnknownChannelName(item.channelId);
    };

    /**
     * 放送局情報が一切引けない場合の表示名を返す
     * channelId は networkId * 100000 + serviceId で構成されるため、分解して表示する
     * @param channelId: apid.ChannelId
     * @return string
     */
    export const getUnknownChannelName = (channelId: apid.ChannelId): string => {
        const networkId = Math.floor(channelId / 100000);
        const serviceId = channelId % 100000;

        return `不明な放送局 (NID: ${networkId} / SID: ${serviceId})`;
    };
}

export default ChannelNameUtil;
