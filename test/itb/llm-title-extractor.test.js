'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpStubServer } = require('../support/HttpStubServer');
const LlmTitleExtractor = require('../../dist/model/series/LlmTitleExtractor').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, debug: () => {} },
    }),
};

// 永続キャッシュは使わない (毎回 LLM へ問い合わせる経路を検証したいため)
const cacheDB = {
    get: async () => null,
    set: async () => {},
};

const json = (response, body) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
};

/**
 * 本文を返す通常の応答
 */
const contentResponse = title => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title }) } }],
    usage: { completion_tokens: 12 },
});

/**
 * 思考でトークンを使い切って本文が空のまま切れた応答 (reasoning 系モデルで実際に起きる)
 */
const truncatedResponse = maxTokens => ({
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { completion_tokens: maxTokens },
});

function makeExtractor(baseUrl, seriesLlm = {}) {
    const config = {
        getConfig: () => ({
            seriesLlm: { url: `${baseUrl}/v1`, model: 'test-model', ...seriesLlm },
        }),
    };
    return new LlmTitleExtractor(logger, config, cacheDB);
}

test('llm extractor returns the title from a normal response', async t => {
    const stub = new HttpStubServer((_request, response) => json(response, contentResponse('それいけ!アンパンマン')));
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const extractor = makeExtractor(baseUrl);
    assert.equal(await extractor.extractWorkTitle('それいけ!アンパンマン「カレーパンマン」[多]'), 'それいけ!アンパンマン');

    const body = JSON.parse(stub.requests[0].body);
    assert.equal(body.max_tokens, 2000);
    // 思考を切れるモデルでは切る (未知のキーとして無視されても害はない)
    assert.deepEqual(body.reasoning, { enabled: false });
});

test('llm extractor retries with a larger budget when the answer is cut off by max_tokens', async t => {
    let calls = 0;
    const stub = new HttpStubServer((_request, response) => {
        calls++;
        // 1 回目は思考でトークンを使い切って本文が空、2 回目は本文が返る
        json(response, calls === 1 ? truncatedResponse(2000) : contentResponse('バナナマンのせっかくグルメ'));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const extractor = makeExtractor(baseUrl);
    const title = await extractor.extractWorkTitle('バナナマンのせっかくグルメ★日村が秋田で2時間SP');
    assert.equal(title, 'バナナマンのせっかくグルメ');
    assert.equal(calls, 2);
    assert.equal(JSON.parse(stub.requests[0].body).max_tokens, 2000);
    // 4 倍に引き上げてやり直す
    assert.equal(JSON.parse(stub.requests[1].body).max_tokens, 8000);
});

test('the escalated budget is remembered so later titles do not waste a round trip', async t => {
    let calls = 0;
    const stub = new HttpStubServer((_request, response) => {
        calls++;
        json(response, calls === 1 ? truncatedResponse(2000) : contentResponse('作品名'));
    });
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const extractor = makeExtractor(baseUrl);
    await extractor.extractWorkTitle('1 本目のタイトル');
    await extractor.extractWorkTitle('2 本目のタイトル');

    assert.equal(calls, 3);
    // 2 本目は最初から引き上げ後の上限で問い合わせる
    assert.equal(JSON.parse(stub.requests[2].body).max_tokens, 8000);
});

test('the answer is picked up from the reasoning field when the content is empty', async t => {
    const stub = new HttpStubServer((_request, response) =>
        json(response, {
            choices: [
                {
                    finish_reason: 'stop',
                    message: { content: '', reasoning: 'これはシリーズ番組です。{"title": "情報番組"}' },
                },
            ],
            usage: { completion_tokens: 30 },
        }),
    );
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const extractor = makeExtractor(baseUrl);
    assert.equal(await extractor.extractWorkTitle('情報番組 10月28日'), '情報番組');
    // 本文が空でも答えが取れたのでやり直さない
    assert.equal(stub.requests.length, 1);
});

test('the retry stops at the configured ceiling instead of escalating forever', async t => {
    const stub = new HttpStubServer((_request, response) => json(response, truncatedResponse(4000)));
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    // 上限に達している場合はやり直さず失敗として扱う
    const extractor = makeExtractor(baseUrl, { maxTokens: 4000, maxTokensLimit: 4000 });
    assert.equal(await extractor.extractWorkTitle('タイトル'), null);
    assert.equal(stub.requests.length, 1);
});

test('a truncated response still fails when the retry does not produce content either', async t => {
    const stub = new HttpStubServer((_request, response) => json(response, truncatedResponse(2000)));
    const baseUrl = await stub.start();
    t.after(() => stub.stop());

    const extractor = makeExtractor(baseUrl, { maxTokensLimit: 8000 });
    assert.equal(await extractor.extractWorkTitle('タイトル'), null);
    assert.equal(stub.requests.length, 2);
});
