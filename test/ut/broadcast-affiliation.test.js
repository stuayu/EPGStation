'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const BroadcastAffiliation = require('../../dist/model/channel/BroadcastAffiliation').default;
const BroadcastAffiliationCollector = require('../../dist/model/channel/BroadcastAffiliationCollector').default;

const createDBStub = items => {
    return {
        items: items ?? [],
        replaced: [],
        async findAll() {
            return this.items;
        },
        async replace(networkId, affiliationIds) {
            this.replaced.push({ networkId: networkId, affiliationIds: affiliationIds });

            return true;
        },
    };
};

const createLoggerStub = () => {
    return {
        getLogger: () => {
            return { system: { info: () => {}, warn: () => {}, error: () => {} } };
        },
    };
};

test('BIT を受信済みの放送局は系列に分類される', async () => {
    const db = createDBStub([{ networkId: 0x7fe0, affiliationId: 0x02, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 0x7fe0, channelType: 'GR' });
    assert.equal(result.id, 'ntv');
    assert.equal(result.order, 3);
});

// BIT も同梱データも無い放送局 (ケーブル局など) だけが未分類になる
test('BIT 未受信かつ同梱データにも無い放送局は未分類になる', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 12345, channelType: 'GR' });
    assert.equal(result.id, 'unknown');
    assert.equal(result.order, 99);
});

// BIT はその局を実際に受信するまで集まらないため、公知の系列を同梱データで補う
test('BIT 未受信の放送局は同梱データの系列で補完される', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    // 福島中央テレビ (日テレ系) / NHK総合・東京
    assert.equal(affiliation.getAffiliation({ networkId: 32419, channelType: 'GR' }).id, 'ntv');
    assert.equal(affiliation.getAffiliation({ networkId: 32736, channelType: 'GR' }).id, 'nhk_g');
});

// 実際の送出が唯一の正なので、BIT を受信済みの局は同梱データより BIT を優先する
test('BIT を受信済みの放送局は同梱データより BIT を優先する', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([{ networkId: 32419, affiliationId: 0x03 }]));
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 32419, channelType: 'GR' }).id, 'tbs');
});

test('BS / CS / SKY は系列別に分けない', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 4, channelType: 'BS' }), null);
    assert.equal(affiliation.getAffiliation({ networkId: 6, channelType: 'CS' }), null);
    assert.equal(affiliation.getAffiliation({ networkId: 1, channelType: 'SKY' }), null);
});

test('県外地上波 (NWxx) も系列別に分ける対象になる', async () => {
    const db = createDBStub([{ networkId: 0x7fe5, affiliationId: 0x04, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 0x7fe5, channelType: 'NW3' }).id, 'cx');
});

test('クロスネット局は表示順が先の系列にまとめられる', async () => {
    const db = createDBStub([
        { networkId: 0x7fe1, affiliationId: 0x04, updatedAt: 1 }, // フジテレビ系 (order 7)
        { networkId: 0x7fe1, affiliationId: 0x05, updatedAt: 1 }, // テレビ朝日系 (order 4)
    ]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 0x7fe1, channelType: 'GR' }).id, 'ex');
});

test('未知の系列識別は「その他」として扱う', async () => {
    const db = createDBStub([{ networkId: 0x7fe2, affiliationId: 0x33, updatedAt: 1 }]);
    const affiliation = new BroadcastAffiliation(db);
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({ networkId: 0x7fe2, channelType: 'GR' });
    assert.equal(result.id, 'other_51');
    assert.equal(result.order, 95);
});

test('系列一覧は表示順で返り、未分類が末尾になる', () => {
    const list = new BroadcastAffiliation(createDBStub([])).getAffiliations();

    assert.deepEqual(
        list.map(i => i.id),
        ['nhk_g', 'nhk_e', 'ntv', 'ex', 'tbs', 'tx', 'cx', 'independent', 'unknown'],
    );
});

test('BIT の broadcasters が示す original_network_id へ系列を割り当てる', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe0,
            broadcasters: [
                {
                    broadcasterId: 0x01,
                    terrestrialBroadcasterId: 0x0001,
                    affiliationIds: [0x02],
                    networkIds: [0x7fe0, 0x7fe4],
                },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [
        { networkId: 0x7fe0, affiliationIds: [0x02] },
        { networkId: 0x7fe4, affiliationIds: [0x02] },
    ]);
});

test('放送事業者が複数ある場合、対象の networkId が不明な事業者は保存しない', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe0,
            broadcasters: [
                { broadcasterId: 0x01, terrestrialBroadcasterId: 1, affiliationIds: [0x02], networkIds: [] },
                { broadcasterId: 0x02, terrestrialBroadcasterId: 2, affiliationIds: [0x03], networkIds: [0x7fe1] },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [{ networkId: 0x7fe1, affiliationIds: [0x03] }]);
});

test('放送事業者が 1 つだけならセクションの original_network_id へ割り当てる', async () => {
    const db = createDBStub([]);
    const collector = new BroadcastAffiliationCollector(db, createLoggerStub());

    await collector.collect([
        {
            originalNetworkId: 0x7fe9,
            broadcasters: [
                { broadcasterId: 0x01, terrestrialBroadcasterId: 1, affiliationIds: [0x07], networkIds: [] },
            ],
        },
    ]);

    assert.deepEqual(db.replaced, [{ networkId: 0x7fe9, affiliationIds: [0x07] }]);
});

// networkId が同梱データに無い局は放送局名から系列を引く (全国の民放を Wikipedia の
// 各ニュースネットワーク加盟局一覧から収録している)
test('同梱データに無い networkId でも放送局名から系列を引ける', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();
    const of = name => affiliation.getAffiliation({ networkId: 99999, channelType: 'GR', name }).id;

    // 実機に無い地域の局 (この環境の channel テーブルには入っていない)
    assert.equal(of('MRT宮崎放送'), 'tbs');
    assert.equal(of('KKB鹿児島放送'), 'ex');
    assert.equal(of('沖縄テレビ'), 'cx');
    assert.equal(of('高知放送1'), 'ntv');
    assert.equal(of('テレビ大阪1'), 'tx');
    assert.equal(of('サンテレビ'), 'independent');
    assert.equal(of('NHK総合1・鳥取'), 'nhk_g');
    assert.equal(of('NHKEテレ1鳥取'), 'nhk_e');
});

// 「大分放送」と「大分朝日放送」のように一方が他方を含む組み合わせがあるため、
// 局名の照合は必ず長い名前から行う
test('紛らわしい放送局名を取り違えない', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();
    const of = name => affiliation.getAffiliation({ networkId: 99999, channelType: 'GR', name }).id;

    assert.equal(of('OBS大分放送'), 'tbs');
    assert.equal(of('OAB大分朝日放送1'), 'ex');
    assert.equal(of('TOSテレビ大分1'), 'ntv');
    assert.equal(of('青森放送'), 'ntv');
    assert.equal(of('青森朝日放送'), 'ex');
    assert.equal(of('青森テレビ'), 'tbs');
    assert.equal(of('北海道テレビ'), 'ex');
    assert.equal(of('テレビ北海道'), 'tx');
    assert.equal(of('広島テレビ1'), 'ntv');
    assert.equal(of('テレビ新広島1'), 'cx');
    assert.equal(of('広島ホームテレビ1'), 'ex');
    assert.equal(of('鹿児島テレビ'), 'cx');
    assert.equal(of('鹿児島讀賣テレビ'), 'ntv');
    assert.equal(of('長崎放送'), 'tbs');
    assert.equal(of('NCC長崎文化放送1'), 'ex');
});

// 略称は 3 文字程度で偶然一致しやすいため完全一致でのみ引く
// (サブチャンネル番号は落としてから比較する)
test('略称は完全一致でのみ系列を引く', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();
    const of = name => affiliation.getAffiliation({ networkId: 99999, channelType: 'GR', name }).id;

    assert.equal(of('HBC'), 'tbs');
    assert.equal(of('HTB1'), 'ex');
    assert.equal(of('TVh1'), 'tx');
    assert.equal(of('OHK'), 'cx');
    // 略称を含むだけの別名は引かない (未分類のまま)
    assert.equal(of('HBCラジオ第2'), 'unknown');
});

// BS / CS は系列という概念が無いので、局名が一致しても系列を付けない
test('BS / CS は局名が一致しても系列を付けない', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    assert.equal(affiliation.getAffiliation({ networkId: 4, channelType: 'BS', name: 'BS日テレ' }), null);
});

// ARIB 上は 0x00 = NHK総合 / 0x01 = NHK Eテレ だが、実際の送出では Eテレの BIT にも
// 0x00 が入っている環境がある。総合と Eテレは編成が別物なので局名の方を信用する
test('BIT が NHK総合と言っていても局名が Eテレなら Eテレとして扱う', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([{ networkId: 32417, affiliationId: 0x00 }]));
    await affiliation.updateCache();

    const result = affiliation.getAffiliation({
        networkId: 32417,
        channelType: 'GR',
        name: 'NHKEテレ1福島',
    });
    assert.equal(result.id, 'nhk_e');
});

test('逆に BIT が Eテレと言っていても局名が総合なら総合として扱う', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([{ networkId: 32416, affiliationId: 0x01 }]));
    await affiliation.updateCache();

    assert.equal(
        affiliation.getAffiliation({ networkId: 32416, channelType: 'GR', name: 'NHK総合1・福島' }).id,
        'nhk_g',
    );
    // 「NHK教育」表記も Eテレ扱い
    assert.equal(
        affiliation.getAffiliation({ networkId: 32417, channelType: 'GR', name: 'NHK教育・福島' }).id,
        'nhk_e',
    );
});

// 民放は BIT の系列識別が正しく入っているので局名で上書きしない
test('民放の系列は局名で決め直さない', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([{ networkId: 32419, affiliationId: 0x03 }]));
    await affiliation.updateCache();

    // BIT が TBS 系と言っているならそれに従う (同梱データは日テレ系)
    assert.equal(
        affiliation.getAffiliation({ networkId: 32419, channelType: 'GR', name: '福島中央テレビ1' }).id,
        'tbs',
    );
});

// 関東の独立局 (全国独立放送協議会) はひとまとまりで扱えないと、
// 同じ番組を別々の局で録っている環境で系列別の一覧がばらける
test('関東の独立局 (東京MX・群馬・とちぎ・テレ玉・tvk) は同じ系列にまとまる', async () => {
    const affiliation = new BroadcastAffiliation(createDBStub([]));
    await affiliation.updateCache();

    // networkId は実測値 (同梱データ) から。県外地上波 (NWxx) でも同じ系列になる
    const targets = [
        { networkId: 32391, channelType: 'NW22', name: 'TOKYO MX1' },
        { networkId: 32359, channelType: 'NW22', name: 'ぐんまテレビ' },
        { networkId: 32295, channelType: 'NW22', name: 'テレ玉1' },
        { networkId: 32375, channelType: 'NW22', name: 'tvk1' },
        { networkId: 32327, channelType: 'GR', name: 'チバテレ1' },
    ];
    for (const target of targets) {
        assert.equal(affiliation.getAffiliation(target).id, 'independent', `${target.name} が独立系にならない`);
    }

    // とちぎテレビは networkId の実測値が同梱データに無いので局名から引く
    assert.equal(
        affiliation.getAffiliation({ networkId: 99999, channelType: 'NW22', name: 'とちぎテレビ' }).id,
        'independent',
    );
});
