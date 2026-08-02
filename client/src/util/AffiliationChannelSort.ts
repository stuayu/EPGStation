/**
 * 系列別番組表の放送局の並び順。
 *
 * 系列で絞った番組表は「キー局を先頭」に置き、その後は都道府県コード順で並べる。
 * 都道府県コードは `channel.region.order` (JIS X 0401。複数県をまとめた広域圏は
 * 最小の県コード、判定不能は 99) をそのまま使う。
 */
import * as apid from '../../../api';

// キー局の networkId。関東広域の 7 局が各系列のキー局にあたる
// (NHK 総合 / NHK E テレ / 日テレ / TBS / フジ / テレ朝 / テレ東)
const KEY_STATION_NETWORK_IDS: ReadonlySet<number> = new Set([32736, 32737, 32738, 32739, 32740, 32741, 32742]);

// 地域を判定できなかった放送局を末尾へ送るための order
const UNKNOWN_REGION_ORDER = 99;

/**
 * 放送局がキー局か
 * @param channel: apid.ScheduleChannleItem
 * @return boolean
 */
export const isKeyStation = (channel: apid.ScheduleChannleItem): boolean => {
    return KEY_STATION_NETWORK_IDS.has(channel.networkId);
};

/**
 * 系列別番組表用に放送局を並べ替える (キー局が先頭、その後は都道府県コード順)
 * @param items: T[] 並べ替える対象
 * @param getChannel: (item: T) => apid.ScheduleChannleItem 対象から放送局情報を取り出す
 * @return T[] 並べ替えた新しい配列
 */
export const sortByKeyStationAndPrefecture = <T>(items: T[], getChannel: (item: T) => apid.ScheduleChannleItem): T[] => {
    return [...items].sort((a, b) => {
        const channelA = getChannel(a);
        const channelB = getChannel(b);

        // キー局を必ず先頭にする
        const keyA = isKeyStation(channelA) === true ? 0 : 1;
        const keyB = isKeyStation(channelB) === true ? 0 : 1;
        if (keyA !== keyB) {
            return keyA - keyB;
        }

        // 都道府県コード順 (地域不明は末尾)
        const orderA = channelA.region?.order ?? UNKNOWN_REGION_ORDER;
        const orderB = channelB.region?.order ?? UNKNOWN_REGION_ORDER;
        if (orderA !== orderB) {
            return orderA - orderB;
        }

        // 同一地域内は放送局 id 順で安定させる
        return channelA.id - channelB.id;
    });
};
