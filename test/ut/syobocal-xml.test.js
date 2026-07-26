'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { xmlItems, parseSyobocalDate } = require('../../dist/model/metadata/syobocal/SyobocalXml');

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
