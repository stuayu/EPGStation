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
