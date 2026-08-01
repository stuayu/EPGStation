'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    xmlItems,
    parseSyobocalDate,
    assertSyobocalResponse,
} = require('../../dist/model/metadata/syobocal/SyobocalXml');

test('parses flat items (baseline TitleLookup/ProgLookup shape)', () => {
    const xml = `<TitleLookupResponse><TitleItems><TitleItem><TID>100</TID><Title>作品名</Title></TitleItem></TitleItems></TitleLookupResponse>`;
    const rows = xmlItems(xml, 'TitleItem');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].TID, '100');
    assert.equal(rows[0].Title, '作品名');
});

test('ignores nested child elements under a same-named field (nested tags)', () => {
    const xml = `<Root><ProgItem><PID>1</PID><Extra><PID>should-be-ignored</PID></Extra></ProgItem></Root>`;
    const rows = xmlItems(xml, 'ProgItem');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].PID, '1');
    assert.equal(rows[0].Extra, undefined);
});

test('handles repeated (same-name) items at different nesting depths without cross-contamination', () => {
    const xml =
        `<Root><Wrapper><ProgItem><PID>1</PID></ProgItem></Wrapper>` +
        `<ProgItem><PID>2</PID></ProgItem></Root>`;
    const rows = xmlItems(xml, 'ProgItem');
    assert.deepEqual(
        rows.map(x => x.PID),
        ['1', '2'],
    );
});

test('decodes CDATA sections', () => {
    const xml = `<Root><TitleItem><Title><![CDATA[<角括弧 & "引用符">]]></Title></TitleItem></Root>`;
    const rows = xmlItems(xml, 'TitleItem');
    assert.equal(rows[0].Title, '<角括弧 & "引用符">');
});

test('ignores attributes on item and field tags', () => {
    const xml = `<Root><ProgItem id="1"><TID attr="x">200</TID></ProgItem></Root>`;
    const rows = xmlItems(xml, 'ProgItem');
    assert.equal(rows[0].TID, '200');
});

test('does not throw on malformed XML and degrades gracefully', () => {
    const broken = '<Root><ProgItem><PID>1</ProgItem>';
    assert.doesNotThrow(() => xmlItems(broken, 'ProgItem'));
});

test('returns an empty array (not an exception) for completely invalid input', () => {
    assert.deepEqual(xmlItems('not xml at all {}', 'ProgItem'), []);
});

test('parseSyobocalDate parses JST-naive timestamps', () => {
    const t = parseSyobocalDate('2024-01-01 21:00:00');
    assert.equal(typeof t, 'number');
    assert.equal(new Date(t).toISOString(), '2024-01-01T12:00:00.000Z');
});

test('parseSyobocalDate returns undefined for unparsable input', () => {
    assert.equal(parseSyobocalDate('not-a-date'), undefined);
});

// Cloudflare のレート制限 (error 1015) やメンテナンス時は XML ではなく HTML が返る。
// これを黙って空配列にすると正常な「該当なし」と区別できず、失敗をキャッシュしてしまう
test('assertSyobocalResponse() rejects a non-XML response', () => {
    const html = '<!doctype html><html><head><title>Access denied | cal.syoboi.jp</title></head></html>';
    assert.throws(() => assertSyobocalResponse(html, 'ProgLookupResponse'), /SyobocalInvalidResponse/);
});

test('assertSyobocalResponse() accepts data and no-data responses', () => {
    const ok = '<?xml version="1.0"?><ProgLookupResponse><Result><Code>200</Code></Result><ProgItems></ProgItems></ProgLookupResponse>';
    const notFound =
        '<?xml version="1.0"?><ProgLookupResponse><Result><Code>404</Code><Message>条件に一致するデータは存在しません</Message></Result></ProgLookupResponse>';
    assert.doesNotThrow(() => assertSyobocalResponse(ok, 'ProgLookupResponse'));
    // 404 は「その条件の放送が無い」という正常な応答なので通す
    assert.doesNotThrow(() => assertSyobocalResponse(notFound, 'ProgLookupResponse'));
});

test('assertSyobocalResponse() rejects an error result code', () => {
    const error = '<?xml version="1.0"?><ProgLookupResponse><Result><Code>500</Code></Result></ProgLookupResponse>';
    assert.throws(() => assertSyobocalResponse(error, 'ProgLookupResponse'), /SyobocalResultCode:500/);
});

test('assertSyobocalResponse() rejects a response for a different command', () => {
    const other = '<?xml version="1.0"?><TitleLookupResponse><Result><Code>200</Code></Result></TitleLookupResponse>';
    assert.throws(() => assertSyobocalResponse(other, 'ProgLookupResponse'), /SyobocalInvalidResponse/);
});
