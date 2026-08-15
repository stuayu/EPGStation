'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { getAccessPort } = require('../../dist/model/service/api');

/**
 * express の Request を最低限まねる
 * @param headers: { [name: string]: string } ヘッダ (小文字で渡す)
 * @param protocol: string
 */
const createRequest = (headers, protocol = 'http') => {
    return {
        protocol: protocol,
        header: name => headers[name.toLowerCase()],
    };
};

test('host のポートを読む', () => {
    assert.equal(getAccessPort(createRequest({ host: 'localhost:8888' })), 8888);
});

test('x-forwarded-host を host より優先する', () => {
    // プロキシは host を自分の宛先へ書き換えることがあるため、クライアントが見ている側を採る
    const req = createRequest({ host: 'localhost:8888', 'x-forwarded-host': 'epgstation.example.com:8443' });
    assert.equal(getAccessPort(req), 8443);
});

test('プロキシを複数経由した場合はクライアントに近い側を見る', () => {
    const req = createRequest({ 'x-forwarded-host': 'front.example.com:8443, back.example.com:8888' });
    assert.equal(getAccessPort(req), 8443);
});

test('ポートの指定が無ければプロトコルの既定ポートを返す', () => {
    assert.equal(getAccessPort(createRequest({ host: 'epgstation.example.com' })), 80);
    assert.equal(getAccessPort(createRequest({ host: 'epgstation.example.com' }, 'https')), 443);
    // プロキシが TLS を終端している場合は x-forwarded-proto で判断する
    assert.equal(
        getAccessPort(createRequest({ host: 'epgstation.example.com', 'x-forwarded-proto': 'https' })),
        443,
    );
});

test('IPv6 リテラルのコロンをポート区切りと取り違えない', () => {
    assert.equal(getAccessPort(createRequest({ host: '[::1]:8888' })), 8888);
    assert.equal(getAccessPort(createRequest({ host: '[::1]' })), 80);
});

test('ホストが分からない場合は null を返す', () => {
    assert.equal(getAccessPort(createRequest({})), null);
});

test('ポートが数値でない場合は null を返す', () => {
    assert.equal(getAccessPort(createRequest({ host: 'localhost:abc' })), null);
});
