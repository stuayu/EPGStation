import { injectable } from 'inversify';
import IBroadcastRegion, { BroadcastRegionItem, BroadcastRegionTarget } from './IBroadcastRegion';

/**
 * 地上デジタル放送の地域判定
 *
 * TSID (networkId) と serviceId に含まれる地域符号 (serviceId / 1024) から
 * 番組表の地域グループを求める。
 * 参考: https://jp-tower.com/isdb-tsid-list/ , http://soranikakaruhashi.blog.fc2.com/blog-entry-71.html
 */
@injectable()
export default class BroadcastRegion implements IBroadcastRegion {
    // 地域判定できなかった場合のグループ id
    private static readonly OTHER_REGION_ID = 'other';

    // 「その他」を必ず末尾にするための order (都道府県コードより大きい値)
    private static readonly OTHER_REGION_ORDER = 99;

    // 地域グループ定義
    // order は都道府県コード (JIS X 0401)。複数県をまとめたグループは最小の県コードを使う
    // (例: 関東 = 茨城 8、中京 = 岐阜 21、近畿 = 滋賀 25)。判定不能の「その他」は必ず末尾
    private static readonly REGION_DEFINITIONS: BroadcastRegionItem[] = [
        { id: 'hokkaido', name: '北海道', order: 1 },
        { id: 'aomori', name: '青森', order: 2 },
        { id: 'iwate', name: '岩手', order: 3 },
        { id: 'miyagi', name: '宮城', order: 4 },
        { id: 'akita', name: '秋田', order: 5 },
        { id: 'yamagata', name: '山形', order: 6 },
        { id: 'fukushima', name: '福島', order: 7 },
        { id: 'kanto', name: '関東', order: 8 },
        { id: 'niigata', name: '新潟', order: 15 },
        { id: 'toyama', name: '富山', order: 16 },
        { id: 'ishikawa', name: '石川', order: 17 },
        { id: 'fukui', name: '福井', order: 18 },
        { id: 'yamanashi', name: '山梨', order: 19 },
        { id: 'nagano', name: '長野', order: 20 },
        { id: 'chukyo', name: '中京', order: 21 },
        { id: 'shizuoka', name: '静岡', order: 22 },
        { id: 'kinki', name: '近畿', order: 25 },
        { id: 'tottori_shimane', name: '鳥取・島根', order: 31 },
        { id: 'okayama_kagawa', name: '岡山・香川', order: 33 },
        { id: 'hiroshima', name: '広島', order: 34 },
        { id: 'yamaguchi', name: '山口', order: 35 },
        { id: 'tokushima', name: '徳島', order: 36 },
        { id: 'ehime', name: '愛媛', order: 38 },
        { id: 'kochi', name: '高知', order: 39 },
        { id: 'fukuoka', name: '福岡', order: 40 },
        { id: 'saga', name: '佐賀', order: 41 },
        { id: 'nagasaki', name: '長崎', order: 42 },
        { id: 'kumamoto', name: '熊本', order: 43 },
        { id: 'oita', name: '大分', order: 44 },
        { id: 'miyazaki', name: '宮崎', order: 45 },
        { id: 'kagoshima', name: '鹿児島', order: 46 },
        { id: 'okinawa', name: '沖縄', order: 47 },
        { id: 'other', name: 'その他 (CATV 等)', order: BroadcastRegion.OTHER_REGION_ORDER },
    ];

    // 地域符号 (serviceId / 1024) → 地域グループ id
    // 広域圈とその域内の県域局 (独立局) は同じグループにまとめる
    private static readonly AREA_CODE_MAP: { [areaCode: number]: string } = {
        1: 'kanto', // 関東広域
        2: 'kinki', // 近畿広域
        3: 'chukyo', // 中京広域
        4: 'hokkaido', // 北海道域
        5: 'okayama_kagawa', // 岡山香川
        6: 'tottori_shimane', // 島根鳥取
        10: 'hokkaido', // 札幌
        11: 'hokkaido', // 函館
        12: 'hokkaido', // 旭川
        13: 'hokkaido', // 帯広
        14: 'hokkaido', // 釧路
        15: 'hokkaido', // 北見
        16: 'hokkaido', // 室蘭
        17: 'miyagi',
        18: 'akita',
        19: 'yamagata',
        20: 'iwate',
        21: 'fukushima',
        22: 'aomori',
        23: 'kanto', // 東京 (TOKYO MX など)
        24: 'kanto', // 神奈川 (tvk)
        25: 'kanto', // 群馬 (ぐんまちゃん)
        26: 'kanto', // 茨城
        27: 'kanto', // 千葉 (チバテレ)
        28: 'kanto', // 栃木 (とちぎテレビ)
        29: 'kanto', // 埼玉 (テレ玉)
        30: 'nagano',
        31: 'niigata',
        32: 'yamanashi',
        33: 'chukyo', // 愛知
        34: 'ishikawa',
        35: 'shizuoka',
        36: 'fukui',
        37: 'toyama',
        38: 'chukyo', // 三重
        39: 'chukyo', // 岐阜
        40: 'kinki', // 大阪
        41: 'kinki', // 京都
        42: 'kinki', // 兵庫
        43: 'kinki', // 和歌山
        44: 'kinki', // 奈良
        45: 'kinki', // 滋賀
        46: 'hiroshima',
        47: 'okayama_kagawa', // 岡山
        48: 'tottori_shimane', // 島根
        49: 'tottori_shimane', // 鳥取
        50: 'yamaguchi',
        51: 'ehime',
        52: 'okayama_kagawa', // 香川
        53: 'tokushima',
        54: 'kochi',
        55: 'fukuoka',
        56: 'kumamoto',
        57: 'nagasaki',
        58: 'kagoshima',
        59: 'miyazaki',
        60: 'oita',
        61: 'saga',
        62: 'okinawa',
    };

    // 地域符号では判定できない (CATV パススルー等の) networkId → 地域グループ id
    private static readonly NETWORK_ID_MAP: { [networkId: number]: string } = {
        32391: 'kanto', // TOKYO MX
        32375: 'kanto', // tvk
        32295: 'kanto', // テレ玉
        32397: 'kanto', // J:COM 関東
        32399: 'kanto', // J:COM 関東
        32112: 'kinki', // 大阪
        32118: 'kinki', // 大阪
        32125: 'kinki', // Baycom
        32127: 'kinki', // Baycom
    };

    // 地域符号の算出に使う除数
    private static readonly AREA_CODE_DIVISOR = 1024;

    /**
     * 地域別に分ける対象の放送波か
     * BS / CS / SKY は地域に依存しないため対象外
     * @param channelType: string
     * @return boolean
     */
    public isRegionalChannelType(channelType: string): boolean {
        return channelType === 'GR' || /^NW\d+$/.test(channelType) === true;
    }

    /**
     * チャンネル情報から地域を判定する
     * @param target: BroadcastRegionTarget
     * @return BroadcastRegionItem | null 地域別に分けない放送波の場合は null
     */
    public getRegion(target: BroadcastRegionTarget): BroadcastRegionItem | null {
        if (this.isRegionalChannelType(target.channelType) === false) {
            return null;
        }

        const byNetworkId = BroadcastRegion.NETWORK_ID_MAP[target.networkId];
        if (typeof byNetworkId !== 'undefined') {
            return BroadcastRegion.findRegion(byNetworkId);
        }

        const areaCode = Math.floor(target.serviceId / BroadcastRegion.AREA_CODE_DIVISOR);
        const byAreaCode = BroadcastRegion.AREA_CODE_MAP[areaCode];

        return BroadcastRegion.findRegion(
            typeof byAreaCode === 'undefined' ? BroadcastRegion.OTHER_REGION_ID : byAreaCode,
        );
    }

    /**
     * 定義されている地域グループを表示順で返す
     * @return BroadcastRegionItem[]
     */
    public getRegions(): BroadcastRegionItem[] {
        return BroadcastRegion.REGION_DEFINITIONS.map(r => {
            return { id: r.id, name: r.name, order: r.order };
        }).sort((a, b) => a.order - b.order);
    }

    /**
     * 地域 id から地域定義を探す
     * @param id: string
     * @return BroadcastRegionItem
     */
    private static findRegion(id: string): BroadcastRegionItem {
        const region = BroadcastRegion.REGION_DEFINITIONS.find(r => r.id === id);

        return typeof region === 'undefined'
            ? {
                  id: BroadcastRegion.OTHER_REGION_ID,
                  name: 'その他 (CATV 等)',
                  order: BroadcastRegion.OTHER_REGION_ORDER,
              }
            : { id: region.id, name: region.name, order: region.order };
    }
}
