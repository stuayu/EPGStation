'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');

const BroadcastRegion = require('../../dist/model/channel/BroadcastRegion').default;

const createRegion = () => new BroadcastRegion();

test('関東広域の serviceId から関東と判定される', () => {
    const region = createRegion().getRegion({ networkId: 32736, serviceId: 1024, channelType: 'GR' });
    assert.deepEqual(region, { id: 'kanto', name: '関東', order: 8 });
});

test('東京の独立局 (TOKYO MX) は関東にマージされる', () => {
    const region = createRegion().getRegion({ networkId: 32391, serviceId: 23608, channelType: 'GR' });
    assert.equal(region.id, 'kanto');
});

test('tvk / テレ玉 も関東にマージされる', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 32375, serviceId: 24632, channelType: 'GR' }).id, 'kanto');
    assert.equal(r.getRegion({ networkId: 32295, serviceId: 29752, channelType: 'GR' }).id, 'kanto');
});

test('北海道の各地区は北海道にまとめられる', () => {
    const r = createRegion();
    // 北海道域 / 札幌 / 函館 / 帯広 / 北見
    assert.equal(r.getRegion({ networkId: 32693, serviceId: 4136, channelType: 'GR' }).id, 'hokkaido');
    assert.equal(r.getRegion({ networkId: 32595, serviceId: 10264, channelType: 'GR' }).id, 'hokkaido');
    assert.equal(r.getRegion({ networkId: 32578, serviceId: 11280, channelType: 'GR' }).id, 'hokkaido');
    assert.equal(r.getRegion({ networkId: 32546, serviceId: 13328, channelType: 'GR' }).id, 'hokkaido');
    assert.equal(r.getRegion({ networkId: 32515, serviceId: 15384, channelType: 'GR' }).id, 'hokkaido');
});

test('中京・近畿の県域局は広域グループにマージされる', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 32707, serviceId: 3096, channelType: 'GR' }).id, 'chukyo');
    assert.equal(r.getRegion({ networkId: 32723, serviceId: 2072, channelType: 'GR' }).id, 'kinki');
    assert.equal(r.getRegion({ networkId: 32102, serviceId: 42032, channelType: 'GR' }).id, 'kinki'); // KBS 京都
});

test('地域符号から各県を判定できる', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 32482, serviceId: 17424, channelType: 'GR' }).id, 'miyagi');
    assert.equal(r.getRegion({ networkId: 32259, serviceId: 31768, channelType: 'GR' }).id, 'niigata');
    assert.equal(r.getRegion({ networkId: 32194, serviceId: 35856, channelType: 'GR' }).id, 'shizuoka');
    assert.equal(r.getRegion({ networkId: 32018, serviceId: 47120, channelType: 'GR' }).id, 'hiroshima');
    assert.equal(r.getRegion({ networkId: 31938, serviceId: 52240, channelType: 'GR' }).id, 'ehime');
    assert.equal(r.getRegion({ networkId: 31906, serviceId: 54288, channelType: 'GR' }).id, 'tokushima');
    assert.equal(r.getRegion({ networkId: 31888, serviceId: 55296, channelType: 'GR' }).id, 'kochi');
    assert.equal(r.getRegion({ networkId: 31762, serviceId: 63504, channelType: 'GR' }).id, 'okinawa');
});

// 実チャンネル (data/database.db) の serviceId で確認した九州・沖縄の地域符号
test('九州・沖縄の地域符号を取り違えない', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 31874, serviceId: 56336, channelType: 'GR' }).id, 'fukuoka'); // 55 ＫＢＣテレビ
    assert.equal(r.getRegion({ networkId: 31858, serviceId: 57360, channelType: 'GR' }).id, 'kumamoto'); // 56 ＲＫＫ熊本放送
    assert.equal(r.getRegion({ networkId: 31842, serviceId: 58384, channelType: 'GR' }).id, 'nagasaki'); // 57 ＮＢＣ長崎放送
    assert.equal(r.getRegion({ networkId: 31810, serviceId: 59408, channelType: 'GR' }).id, 'kagoshima'); // 58
    assert.equal(r.getRegion({ networkId: 31826, serviceId: 60432, channelType: 'GR' }).id, 'miyazaki'); // 59
    assert.equal(r.getRegion({ networkId: 31794, serviceId: 61456, channelType: 'GR' }).id, 'oita'); // 60 ＯＢＳ大分放送
    assert.equal(r.getRegion({ networkId: 31778, serviceId: 62480, channelType: 'GR' }).id, 'saga'); // 61 ＳＴＳサガテレビ
    assert.equal(r.getRegion({ networkId: 31762, serviceId: 63504, channelType: 'GR' }).id, 'okinawa'); // 62
});

test('島根鳥取・岡山香川は 2 県合同のグループになる', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 32659, serviceId: 6168, channelType: 'GR' }).id, 'tottori_shimane');
    assert.equal(r.getRegion({ networkId: 32676, serviceId: 5136, channelType: 'GR' }).id, 'okayama_kagawa');
});

test('NWxx も地域判定対象になる', () => {
    const region = createRegion().getRegion({ networkId: 32736, serviceId: 1040, channelType: 'NW1' });
    assert.equal(region.id, 'kanto');
});

test('BS / CS / SKY は地域判定対象外 (null)', () => {
    const r = createRegion();
    assert.equal(r.getRegion({ networkId: 4, serviceId: 101, channelType: 'BS' }), null);
    assert.equal(r.getRegion({ networkId: 6, serviceId: 237, channelType: 'CS' }), null);
    assert.equal(r.getRegion({ networkId: 1, serviceId: 300, channelType: 'SKY' }), null);
    assert.equal(r.isRegionalChannelType('BS'), false);
    assert.equal(r.isRegionalChannelType('GR'), true);
    assert.equal(r.isRegionalChannelType('NW12'), true);
});

test('地域符号不明の場合はその他になる', () => {
    const region = createRegion().getRegion({ networkId: 65000, serviceId: 8192, channelType: 'GR' });
    assert.equal(region.id, 'other');
    assert.equal(region.name, 'その他 (CATV 等)');
});

test('getRegions() は重複なしでその他を含む一覧を返す', () => {
    const regions = createRegion().getRegions();
    assert.equal(regions.length > 0, true);
    assert.equal(regions[regions.length - 1].id, 'other');
    assert.equal(new Set(regions.map(r => r.id)).size, regions.length);
});

test('getRegions() は都道府県コード順に並び、その他が末尾になる', () => {
    const regions = createRegion().getRegions();
    const orders = regions.map(r => r.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
    assert.equal(regions[0].id, 'hokkaido');
    assert.equal(regions[regions.length - 1].order, 99);

    // 広域圏は域内で最小の県コードを持つ (関東 = 茨城 8 / 中京 = 岐阜 21 / 近畿 = 滋賀 25)
    const index = {};
    for (const r of regions) index[r.id] = r.order;
    assert.equal(index.kanto, 8);
    assert.equal(index.chukyo, 21);
    assert.equal(index.shizuoka, 22);
    assert.equal(index.kinki, 25);
    assert.equal(index.okinawa, 47);
});
