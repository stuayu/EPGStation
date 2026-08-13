import * as mapid from '../../node_modules/mirakurun/api';

/* eslint-disable no-fallthrough */
namespace ChannelUtil {
    /**
     * Mirakurun の `Service.channel` は配列または単一オブジェクトのどちらでも返るため、
     * 実際に DB / 索引更新で扱う物理チャンネルを正規化する。
     * @param channel Service.channel の値
     * @return 先頭の物理チャンネル情報。無い場合は undefined
     */
    export const resolvePhysicalChannel = (
        channel: mapid.Channel[] | mapid.Channel | undefined | null,
    ): mapid.Channel | undefined => {
        const rawChannel = Array.isArray(channel) ? channel[0] : channel;
        if (typeof rawChannel === 'undefined' || rawChannel === null) {
            return undefined;
        }
        return rawChannel;
    };

    /**
     * 映像・音声サービスであるかを返す
     * @param serviceType: number 対象のサービスタイプ
     * @see https://github.com/DBCTRADO/LibISDB/blob/master/LibISDB/LibISDBConsts.hpp#L122
     */
    export const isMediaService = (serviceType: number): boolean => {
        switch (serviceType) {
            // デジタルTVサービス
            case 0x01:
            // デジタル音声サービス
            case 0x02:
            // 臨時映像サービス
            case 0xa1:
            // 臨時音声サービス
            case 0xa2:
            // プロモーション映像サービス
            case 0xa5:
            // プロモーション音声サービス
            case 0xa6:
            // 超高精細度4K専用TVサービス
            case 0xad:
                return true;
            default:
                return false;
        }
    };
}

export default ChannelUtil;
