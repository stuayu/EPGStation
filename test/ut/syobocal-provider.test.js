'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Provider = require('../../dist/model/metadata/syobocal/SyobocalProvider').default;
const enabled = { getAll: async () => ({ metadata: { syobocal: { enabled: true } } }) };
const title =
    '<TitleItems><TitleItem><TID>123</TID><Title><![CDATA[作品名]]></Title><TitleYomi>さくひんめい</TitleYomi><FirstYear>2024</FirstYear><Comment>説明</Comment></TitleItem></TitleItems>';
test('Syobocal title search normalizes XML results', async () => {
    const p = new Provider({ get: async () => ({ text: title }) }, enabled);
    const x = await p.search('作品名');
    assert.equal(x[0].externalId, '123');
    assert.equal(x[0].score, 1);
});
test('Syobocal detail parses episodes and timestamps', async () => {
    const prog =
        '<ProgItems><ProgItem><TID>123</TID><Count>2</Count><SubTitle>二話</SubTitle><StTime>2024-01-02 01:00:00</StTime></ProgItem></ProgItems>';
    let n = 0;
    const p = new Provider({ get: async () => ({ text: n++ === 0 ? title : prog }) }, enabled);
    const x = await p.get('123');
    assert.equal(x.episodes[0].number, 2);
    assert.equal(x.raw.coverage, 'programs');
});
test('missing regional programme rows keeps title-only metadata', async () => {
    let n = 0;
    const p = new Provider({ get: async () => ({ text: n++ === 0 ? title : '<ProgItems></ProgItems>' }) }, enabled);
    const x = await p.get('123');
    assert.equal(x.title, '作品名');
    assert.equal(x.raw.coverage, 'title-only');
});
test('confirmed match resolves TID via ChID + startAt and places it first', async () => {
    const prog =
        '<ProgItems><ProgItem><TID>555</TID><PID>1</PID><StTime>2024-01-02 01:00:00</StTime></ProgItem></ProgItems>';
    const confirmedTitle =
        '<TitleItems><TitleItem><TID>555</TID><Title><![CDATA[確定作品]]></Title></TitleItem></TitleItems>';
    const calls = [];
    const http = {
        get: async url => {
            calls.push(url);
            if (url.includes('ProgLookup')) return { text: prog };
            if (url.includes('TID=555')) return { text: confirmedTitle };
            return { text: title };
        },
    };
    const channels = { findId: async () => ({ networkId: 32736, serviceId: 1024 }) };
    const channelMap = { find: () => ({ chId: 1, networkId: 32736, serviceId: 1024, syobocal: true }) };
    const p = new Provider(http, enabled, channels, channelMap);
    const startAt = new Date('2024-01-02T01:00:00+09:00').getTime();
    const x = await p.search('作品名', { channelId: 10, startAt });
    assert.equal(x[0].externalId, '555');
    assert.equal(x[0].score, 1);
    assert.ok(calls.some(u => u.includes('ProgLookup')));
});
test('unregistered channel (syobocal: false) skips ProgLookup entirely', async () => {
    const channels = { findId: async () => ({ networkId: 1, serviceId: 2 }) };
    const channelMap = { find: () => ({ chId: 9, networkId: 1, serviceId: 2, syobocal: false }) };
    const http = {
        get: async url => {
            if (url.includes('ProgLookup')) throw Error('must not call ProgLookup for unregistered channel');
            return { text: title };
        },
    };
    const p = new Provider(http, enabled, channels, channelMap);
    const x = await p.search('作品名', { channelId: 10, startAt: Date.now() });
    assert.equal(x[0].externalId, '123');
});
test('unknown channel (no mapping entry) falls back to normal title matching', async () => {
    const channels = { findId: async () => ({ networkId: 1, serviceId: 2 }) };
    const channelMap = { find: () => undefined };
    const http = {
        get: async url => {
            if (url.includes('ProgLookup')) throw Error('must not call ProgLookup for unmapped channel');
            return { text: title };
        },
    };
    const p = new Provider(http, enabled, channels, channelMap);
    const x = await p.search('作品名', { channelId: 10, startAt: Date.now() });
    assert.equal(x[0].externalId, '123');
});
test('disabled provider performs no request', async () => {
    const p = new Provider(
        {
            get: async () => {
                throw Error('unexpected');
            },
        },
        { getAll: async () => ({ metadata: { syobocal: { enabled: false } } }) },
    );
    assert.deepEqual(await p.search('作品'), []);
});
