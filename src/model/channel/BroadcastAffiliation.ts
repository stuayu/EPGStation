import { inject, injectable } from 'inversify';
import IChannelAffiliationDB from '../db/IChannelAffiliationDB';
import IBroadcastAffiliation, { BroadcastAffiliationItem, BroadcastAffiliationTarget } from './IBroadcastAffiliation';

/**
 * 地上デジタル放送の系列判定
 *
 * BIT (Broadcaster Information Table) の extended_broadcaster_descriptor に含まれる
 * 系列識別 (affiliation_id) を DB から読み、放送局 (networkId) を系列にまとめる。
 * BIT は録画・ライブ視聴時に流れてきた分だけ収集する (受動収集) ため、
 * まだ受信していない放送局は「未分類」として扱う。
 */
@injectable()
export default class BroadcastAffiliation implements IBroadcastAffiliation {
    // BIT をまだ受信していない放送局のグループ id
    private static readonly UNKNOWN_AFFILIATION_ID = 'unknown';

    // 系列識別 (affiliation_id) → 系列定義
    // 出典: ARIB TR-B14 第五編 (地上デジタルテレビジョン放送の系列識別)
    // order はリモコンキー ID の並びに合わせている
    private static readonly AFFILIATION_DEFINITIONS: { [affiliationId: number]: BroadcastAffiliationItem } = {
        0x00: { id: 'nhk_g', name: 'NHK総合', order: 1 },
        0x01: { id: 'nhk_e', name: 'NHK Eテレ', order: 2 },
        0x02: { id: 'ntv', name: '日テレ系 (NNN)', order: 3 },
        0x03: { id: 'tbs', name: 'TBS系 (JNN)', order: 5 },
        0x04: { id: 'cx', name: 'フジテレビ系 (FNN)', order: 7 },
        0x05: { id: 'ex', name: 'テレビ朝日系 (ANN)', order: 4 },
        0x06: { id: 'tx', name: 'テレビ東京系 (TXN)', order: 6 },
        0x07: { id: 'independent', name: '独立系', order: 90 },
    };

    // 未知の系列識別に割り当てる表示順 (独立系より後、未分類より前)
    private static readonly OTHER_AFFILIATION_ORDER = 95;

    // 「未分類」の表示順 (必ず末尾)
    private static readonly UNKNOWN_AFFILIATION_ORDER = 99;

    // キャッシュの有効期間 (ms)。Operator が収集した結果を Service 側へ反映するため定期的に読み直す
    private static readonly CACHE_LIFETIME = 60 * 1000;

    private channelAffiliationDB: IChannelAffiliationDB;

    // networkId → 系列識別の一覧
    private cache: { [networkId: number]: number[] } = {};
    private cachedAt = 0;
    private updating: Promise<void> | null = null;

    constructor(@inject('IChannelAffiliationDB') channelAffiliationDB: IChannelAffiliationDB) {
        this.channelAffiliationDB = channelAffiliationDB;
    }

    /**
     * 系列別に分ける対象の放送波か
     * BS / CS / SKY は系列という概念が無いため対象外
     * @param channelType: string
     * @return boolean
     */
    public isAffiliationChannelType(channelType: string): boolean {
        return channelType === 'GR' || /^NW\d+$/.test(channelType) === true;
    }

    /**
     * DB から系列情報を読み直す (有効期間内であれば何もしない)
     * @return Promise<void>
     */
    public async updateCache(): Promise<void> {
        if (new Date().getTime() - this.cachedAt < BroadcastAffiliation.CACHE_LIFETIME) {
            return;
        }

        // 同時に複数の API から呼ばれても DB アクセスは 1 回で済ませる
        if (this.updating !== null) {
            return this.updating;
        }

        this.updating = (async () => {
            try {
                const items = await this.channelAffiliationDB.findAll();
                const cache: { [networkId: number]: number[] } = {};
                for (const item of items) {
                    if (typeof cache[item.networkId] === 'undefined') {
                        cache[item.networkId] = [];
                    }
                    cache[item.networkId].push(item.affiliationId);
                }
                this.cache = cache;
                this.cachedAt = new Date().getTime();
            } finally {
                this.updating = null;
            }
        })();

        return this.updating;
    }

    /**
     * チャンネル情報から系列を判定する
     * 複数系列に属する放送局 (クロスネット局) は表示順が先の系列にまとめる
     * @param target: BroadcastAffiliationTarget
     * @return BroadcastAffiliationItem | null 系列別に分けない放送波の場合は null
     */
    public getAffiliation(target: BroadcastAffiliationTarget): BroadcastAffiliationItem | null {
        if (this.isAffiliationChannelType(target.channelType) === false) {
            return null;
        }

        const affiliationIds = this.cache[target.networkId];
        if (typeof affiliationIds === 'undefined' || affiliationIds.length === 0) {
            return BroadcastAffiliation.getUnknownAffiliation();
        }

        const affiliations = affiliationIds
            .map(id => BroadcastAffiliation.findAffiliation(id))
            .sort((a, b) => a.order - b.order);

        return affiliations[0];
    }

    /**
     * 定義されている系列を表示順で返す
     * @return BroadcastAffiliationItem[]
     */
    public getAffiliations(): BroadcastAffiliationItem[] {
        const result = Object.keys(BroadcastAffiliation.AFFILIATION_DEFINITIONS).map(key => {
            const item = BroadcastAffiliation.AFFILIATION_DEFINITIONS[parseInt(key, 10)];

            return { id: item.id, name: item.name, order: item.order };
        });
        result.push(BroadcastAffiliation.getUnknownAffiliation());

        return result.sort((a, b) => a.order - b.order);
    }

    /**
     * 系列識別から系列定義を返す
     * 未知の系列識別は id に値を含めて表示する
     * @param affiliationId: number
     * @return BroadcastAffiliationItem
     */
    private static findAffiliation(affiliationId: number): BroadcastAffiliationItem {
        const item = BroadcastAffiliation.AFFILIATION_DEFINITIONS[affiliationId];
        if (typeof item !== 'undefined') {
            return { id: item.id, name: item.name, order: item.order };
        }

        return {
            id: `other_${affiliationId}`,
            name: `その他 (系列 ID: ${affiliationId})`,
            order: BroadcastAffiliation.OTHER_AFFILIATION_ORDER,
        };
    }

    /**
     * 「未分類」の系列定義を返す
     * @return BroadcastAffiliationItem
     */
    private static getUnknownAffiliation(): BroadcastAffiliationItem {
        return {
            id: BroadcastAffiliation.UNKNOWN_AFFILIATION_ID,
            name: '未分類',
            order: BroadcastAffiliation.UNKNOWN_AFFILIATION_ORDER,
        };
    }
}
