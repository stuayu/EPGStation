'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildContractXml,
    buildEnumXml,
    buildStringXml,
    escapeXml,
    findChild,
    findChildren,
    getChildBoolean,
    getChildNumber,
    getChildText,
    isNil,
    parseXml,
} = require('../../dist/model/amatsukaze/AmatsukazeXml');

// AmatsukazeServer (C#) の DataContractSerializer が出力する形の XML
const QUEUE_XML = [
    '<UIData xmlns="http://schemas.datacontract.org/2004/07/Amatsukaze.Server"',
    ' xmlns:i="http://www.w3.org/2001/XMLSchema-instance">',
    '<ConsoleData i:nil="true" />',
    '<QueueData><Items>',
    '<QueueItem><Id>12</Id><SrcPath>D:\\rec\\a.ts</SrcPath><State>Encoding</State>',
    '<ActualDstPath i:nil="true" /><ConsoleId>0</ConsoleId><EncodeTime>PT1H2M3.5S</EncodeTime>',
    '<EventName>テスト &amp; 番組</EventName></QueueItem>',
    '<QueueItem><Id>13</Id><SrcPath>D:\\rec\\b.ts</SrcPath><State>Queue</State></QueueItem>',
    '</Items></QueueData>',
    '<State><Pause>false</Pause><Progress>0.25</Progress><Running>true</Running></State>',
    '</UIData>',
].join('');

test('DataContract 形式の XML を要素の入れ子どおりにパースできる', () => {
    const root = parseXml(QUEUE_XML);
    assert.equal(root.name, 'UIData');

    const items = findChildren(findChild(findChild(root, 'QueueData'), 'Items'), 'QueueItem');
    assert.equal(items.length, 2);
    assert.equal(getChildNumber(items[0], 'Id', -1), 12);
    assert.equal(getChildText(items[0], 'SrcPath'), 'D:\\rec\\a.ts');
    assert.equal(getChildText(items[0], 'State'), 'Encoding');
    assert.equal(getChildText(items[1], 'SrcPath'), 'D:\\rec\\b.ts');
});

test('i:nil="true" の要素は null として扱われる', () => {
    const root = parseXml(QUEUE_XML);
    assert.equal(isNil(findChild(root, 'ConsoleData')), true);

    const item = findChildren(findChild(findChild(root, 'QueueData'), 'Items'), 'QueueItem')[0];
    assert.equal(getChildText(item, 'ActualDstPath'), null);
});

test('存在しない子要素は null / 既定値になる', () => {
    const root = parseXml(QUEUE_XML);
    const item = findChildren(findChild(findChild(root, 'QueueData'), 'Items'), 'QueueItem')[1];

    assert.equal(getChildText(item, 'FailReason'), null);
    assert.equal(getChildNumber(item, 'ConsoleId', -1), -1);
    assert.equal(getChildBoolean(item, 'Pause', false), false);
});

test('実体参照を含むテキストが元に戻る', () => {
    const root = parseXml(QUEUE_XML);
    const item = findChildren(findChild(findChild(root, 'QueueData'), 'Items'), 'QueueItem')[0];

    assert.equal(getChildText(item, 'EventName'), 'テスト & 番組');
});

test('数値・真偽値の子要素を型変換して取り出せる', () => {
    const state = findChild(parseXml(QUEUE_XML), 'State');

    assert.equal(getChildNumber(state, 'Progress', 0), 0.25);
    assert.equal(getChildBoolean(state, 'Running', false), true);
    assert.equal(getChildBoolean(state, 'Pause', true), false);
});

test('XML 宣言や自己終了タグが混ざっていてもパースできる', () => {
    const root = parseXml('<?xml version="1.0" encoding="utf-8"?><Root><A /><B>1</B></Root>');

    assert.equal(root.name, 'Root');
    assert.equal(root.children.length, 2);
    assert.equal(getChildNumber(root, 'B', 0), 1);
});

test('ルート要素が無い文字列はエラーになる', () => {
    assert.throws(() => parseXml('not xml'), /root element not found/);
});

test('DataContract の型を C# 側が読める形で書き出せる', () => {
    const xml = buildContractXml('ChangeItemData', [
        { name: 'ChangeType', value: 'Cancel' },
        { name: 'ItemId', value: 12 },
        { name: 'Position', value: 0 },
        { name: 'Priority', value: 0 },
        { name: 'Profile', value: null },
    ]);

    assert.match(xml, /^<ChangeItemData xmlns="http:\/\/schemas\.datacontract\.org\/2004\/07\/Amatsukaze\.Server"/);
    assert.match(xml, /<ChangeType>Cancel<\/ChangeType><ItemId>12<\/ItemId>/);
    // null メンバは i:nil で表現する
    assert.match(xml, /<Profile i:nil="true" \/>/);

    // 書き出した XML は自分でパースし直せる
    const root = parseXml(xml);
    assert.equal(getChildNumber(root, 'ItemId', -1), 12);
    assert.equal(getChildText(root, 'Profile'), null);
});

test('enum と string の RPC 引数を書き出せる', () => {
    assert.equal(
        buildEnumXml('ServerRequest', 'Queue'),
        '<ServerRequest xmlns="http://schemas.datacontract.org/2004/07/Amatsukaze.Server">Queue</ServerRequest>',
    );
    assert.equal(
        buildStringXml('a&b'),
        '<string xmlns="http://schemas.microsoft.com/2003/10/Serialization/">a&amp;b</string>',
    );
});

test('XML エスケープが往復する', () => {
    const source = '<a href="x">&\'</a>';
    const xml = `<Root><Value>${escapeXml(source)}</Value></Root>`;

    assert.equal(getChildText(parseXml(xml), 'Value'), source);
});
