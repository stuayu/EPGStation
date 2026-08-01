import { inject, injectable } from 'inversify';
import IChannelAffiliationDB from '../db/IChannelAffiliationDB';
import { BROADCAST_AFFILIATION_BY_NAME, BROADCAST_AFFILIATION_BY_NETWORK_ID } from './BroadcastAffiliationData';
import IBroadcastAffiliation, { BroadcastAffiliationItem, BroadcastAffiliationTarget } from './IBroadcastAffiliation';

/**
 * 地上デジタル放送の系列判定
 *
 * BIT (Broadcaster Information Table) の extended_broadcaster_descriptor に含まれる
 * 系列識別 (affiliation_id) を DB から読み、放送局 (networkId) を系列にまとめる。
 * BIT は録画・ライブ視聴時に流れてきた分だけ収集する (受動収集) ため、まだ受信していない
 * 放送局については公知の系列を集めた同梱データ (BroadcastAffiliationData) で補う。
 * 同梱データにも無い放送局だけが「未分類」になる。
 * BIT を受信済みの局は常に BIT の内容を優先する (実際の送出が唯一の正)。
 */
@injectable()
export default class BroadcastAffiliation implements IBroadcastAffiliation {
    // BIT をまだ受信していない放送局のグループ id
    private static readonly UNKNOWN_AFFILIATION_ID = 'unknown';
    // NHK の系列識別 (総合 / Eテレ)。局名から決め直すときに使う
    private static readonly NHK_G_AFFILIATION_ID = 0x00;
    private static readonly NHK_E_AFFILIATION_ID = 0x01;

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

        // BIT を受信済みならそれが正。未受信の局だけ同梱データで補う
        const affiliationIds = this.cache[target.networkId] ?? BroadcastAffiliation.bundled(target);
        if (affiliationIds.length === 0) {
            return BroadcastAffiliation.getUnknownAffiliation();
        }

        const affiliations = affiliationIds
            .map(id => BroadcastAffiliation.findAffiliation(id))
            .sort((a, b) => a.order - b.order);

        return BroadcastAffiliation.correctNhk(affiliations[0], target.name);
    }

    /**
     * NHK と判定された局について、総合 / Eテレを放送局名で決め直す。
     *
     * ARIB 上は 0x00 = NHK総合 / 0x01 = NHK Eテレ だが、**実際の送出では Eテレの BIT にも
     * 0x00 (NHK総合) が入っている環境がある** (NHK を 1 事業者として扱っているため)。
     * 総合と Eテレは編成がまったく別物で、しょぼいカレンダーの問い合わせ先 (ChID 1 / 2) も
     * 変わってしまうため、NHK に限っては局名の方を信用する。
     * NHK 以外の系列には手を触れない (民放は BIT の系列識別が正しく入っている)
     * @param item: BroadcastAffiliationItem BIT / 同梱データから引いた系列
     * @param name: string | undefined 放送局名
     * @return BroadcastAffiliationItem
     */
    private static correctNhk(item: BroadcastAffiliationItem, name: string | undefined): BroadcastAffiliationItem {
        if (item.id !== 'nhk_g' && item.id !== 'nhk_e') return item;
        const normalized = BroadcastAffiliation.normalizeName(name);
        if (normalized === '') return item;
        // 「NHKEテレ1福島」「NHK教育」など
        if (/ETV|Eテレ|教育/u.test(normalized) === true) {
            return BroadcastAffiliation.findAffiliation(BroadcastAffiliation.NHK_E_AFFILIATION_ID);
        }
        if (normalized.includes('総合') === true) {
            return BroadcastAffiliation.findAffiliation(BroadcastAffiliation.NHK_G_AFFILIATION_ID);
        }

        return item;
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
     * 同梱データから系列識別を引く (無ければ空配列)。
     * networkId の実測値を最優先で引き、未収録の局は放送局名で引き直す
     * @param target: BroadcastAffiliationTarget
     * @return number[]
     */
    private static bundled(target: BroadcastAffiliationTarget): number[] {
        const byNetworkId = BROADCAST_AFFILIATION_BY_NETWORK_ID[target.networkId];
        if (typeof byNetworkId === 'number') return [byNetworkId];

        const byName = BroadcastAffiliation.findByName(target.name);

        return byName === null ? [] : [byName];
    }

    /**
     * 放送局名から系列識別を引く。
     * 正式名称は含有一致 (EPG の局名にはサブチャンネル番号などが付くため) だが、
     * 「大分放送」と「大分朝日放送」のような紛らわしい組み合わせを取り違えないよう
     * **長い名前から順に**照合する。略称は偶然一致を避けるため完全一致でのみ引く
     * @param name: string | undefined 放送局名
     * @return number | null
     */
    private static findByName(name: string | undefined): number | null {
        const normalized = BroadcastAffiliation.normalizeName(name);
        if (normalized === '') return null;
        // 末尾のサブチャンネル番号を落とした形 (「HTB1」→「HTB」)。略称の完全一致に使う
        const withoutSubChannel = normalized.replace(/\d+$/u, '');

        let best: { affiliationId: number; length: number } | null = null;
        for (const entry of BROADCAST_AFFILIATION_BY_NAME) {
            for (const candidate of entry.names) {
                const key = BroadcastAffiliation.normalizeName(candidate);
                if (key === '' || normalized.includes(key) === false) continue;
                if (best === null || key.length > best.length) {
                    best = { affiliationId: entry.affiliationId, length: key.length };
                }
            }
        }
        if (best !== null) return best.affiliationId;

        for (const entry of BROADCAST_AFFILIATION_BY_NAME) {
            for (const candidate of entry.abbreviations) {
                const key = BroadcastAffiliation.normalizeName(candidate);
                if (key === '') continue;
                if (key === normalized || key === withoutSubChannel) return entry.affiliationId;
            }
        }

        return null;
    }

    /**
     * 放送局名を照合用に正規化する (全角・大文字小文字・記号・空白の揺れを吸収する)
     * @param value: string | undefined
     * @return string
     */
    private static normalizeName(value: string | undefined): string {
        if (typeof value !== 'string') return '';

        return value
            .normalize('NFKC')
            .toUpperCase()
            .replace(/[\s\u3000!-/:-@[-`{-~、。・～〜ー―－‐]/gu, '');
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
