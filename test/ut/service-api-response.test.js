'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../../dist/model/service/api');

/**
 * express.Response の最小スタブ
 * status / json / header / setHeader / write / end / set の呼び出し結果を記録する
 */
const createResponseStub = () => {
    return {
        statusCode: null,
        body: undefined,
        headers: {},
        chunks: [],
        ended: false,
        status(code) {
            this.statusCode = code;

            return this;
        },
        json(body) {
            this.body = body;

            return this;
        },
        header(name, value) {
            this.headers[name] = value;

            return this;
        },
        setHeader(name, value) {
            this.headers[name] = value;

            return this;
        },
        write(chunk) {
            this.chunks.push(chunk);

            return true;
        },
        end() {
            this.ended = true;
        },
    };
};

test('getCookiePath は subDirectory 未設定なら / を返す', () => {
    assert.equal(api.getCookiePath({ getConfig: () => ({}) }), '/');
    assert.equal(api.getCookiePath({ getConfig: () => ({ subDirectory: '' }) }), '/');
});

test('getCookiePath は subDirectory の先頭スラッシュを補う', () => {
    assert.equal(api.getCookiePath({ getConfig: () => ({ subDirectory: 'epgstation' }) }), '/epgstation');
    assert.equal(api.getCookiePath({ getConfig: () => ({ subDirectory: '/epgstation' }) }), '/epgstation');
});

test('getErrorMessage は Error から message を、それ以外は文字列化した値を返す', () => {
    assert.equal(api.getErrorMessage(new Error('failed')), 'failed');
    assert.equal(api.getErrorMessage('plain'), 'plain');
    assert.equal(api.getErrorMessage(123), '123');
});

test('parseRequestParamInt は整数文字列を数値へ変換する', () => {
    assert.equal(api.parseRequestParamInt('42', 'id'), 42);
    assert.equal(api.parseRequestParamInt('-42', 'id'), -42);
});

test('parseRequestParamInt は配列・非整数・安全な整数範囲外を拒否する', () => {
    assert.throws(() => api.parseRequestParamInt(['1'], 'id'), /Invalid route parameter: id/);
    assert.throws(() => api.parseRequestParamInt('1.5', 'id'), /Invalid route parameter: id/);
    assert.throws(() => api.parseRequestParamInt('abc', 'id'), /Invalid route parameter: id/);
    assert.throws(() => api.parseRequestParamInt('9007199254740993', 'id'), /safe integer range: id/);
});

test('parseStreamModeOrProfile は数値へ型変換済みの mode を受け取れる', () => {
    // express-openapi が apiDoc の schema に従って数値へ変換した状態を模す
    const res = createResponseStub();
    const result = api.parseStreamModeOrProfile({ query: { mode: 0 } }, res);
    assert.deepEqual(result, { mode: 0, profile: undefined, audioTrack: undefined });
    assert.equal(res.statusCode, null);
});

test('parseStreamModeOrProfile は型変換を経ない文字列の mode も受け付ける', () => {
    const result = api.parseStreamModeOrProfile({ query: { mode: '2' } }, createResponseStub());
    assert.equal(result.mode, 2);
});

test('parseStreamModeOrProfile は profile 指定時に mode を undefined のまま返す', () => {
    const result = api.parseStreamModeOrProfile({ query: { profile: 'hls-720p' } }, createResponseStub());
    assert.deepEqual(result, { mode: undefined, profile: 'hls-720p', audioTrack: undefined });
});

test('parseStreamModeOrProfile は audioTrack を文字列へ揃える', () => {
    assert.equal(api.parseStreamModeOrProfile({ query: { mode: 0, audioTrack: 'sub' } }, createResponseStub()).audioTrack, 'sub');
    assert.equal(api.parseStreamModeOrProfile({ query: { mode: 0, audioTrack: 1 } }, createResponseStub()).audioTrack, '1');
});

test('parseStreamModeOrProfile は mode と profile がどちらも無ければ 400 を返して null になる', () => {
    const res = createResponseStub();
    assert.equal(api.parseStreamModeOrProfile({ query: {} }, res), null);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'mode or profile is required');
});

test('responseError は指定したコードとメッセージだけを返す', () => {
    const res = createResponseStub();
    api.responseError(res, { code: 404, message: 'not found', errors: 'dropped' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { code: 404, message: 'not found' });
});

test('responseServerError は 500 を返し、詳細があれば errors に載せる', () => {
    const withDetail = createResponseStub();
    api.responseServerError(withDetail, 'boom');
    assert.equal(withDetail.statusCode, 500);
    assert.deepEqual(withDetail.body, { code: 500, message: 'Internal Server Error', errors: 'boom' });

    const withoutDetail = createResponseStub();
    api.responseServerError(withoutDetail);
    assert.deepEqual(withoutDetail.body, { code: 500, message: 'Internal Server Error' });
});

test('responseStreamStartError はエンコード枠不足を 503 として返す', () => {
    const res = createResponseStub();
    api.responseStreamStartError(res, new Error('EncodeProcessManageModelCreateError'));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.message, '同時配信数の上限に達しています');
});

test('responseStreamStartError は予期しないエラーを 500 として返す', () => {
    const res = createResponseStub();
    api.responseStreamStartError(res, new Error('unexpected'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.errors, 'unexpected');
});

test('responseJSON はキャッシュ抑止ヘッダを付ける', () => {
    const res = createResponseStub();
    api.responseJSON(res, 200, { ok: true });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(res.headers['Cache-Control'], 'private, no-cache, no-store, must-revalidate');
    assert.equal(res.headers['Expires'], '-1');
    assert.equal(res.headers['Pragma'], 'no-cache');
});

test('responsePlayList は m3u8 として書き出し、Firefox だけ inline にする', () => {
    const other = createResponseStub();
    api.responsePlayList({ headers: { 'user-agent': 'Safari' } }, other, { name: 'a.m3u8', playList: '#EXTM3U' });
    assert.equal(other.statusCode, 200);
    assert.equal(other.headers['Content-Type'], 'application/x-mpegURL; charset="UTF-8"');
    assert.match(other.headers['Content-Disposition'], /^attachment;/);
    assert.deepEqual(other.chunks, ['#EXTM3U']);
    assert.equal(other.ended, true);

    const firefox = createResponseStub();
    api.responsePlayList({ headers: { 'user-agent': 'Mozilla Firefox' } }, firefox, { name: 'a.m3u8', playList: '#EXTM3U' });
    assert.match(firefox.headers['Content-Disposition'], /^inline;/);
});
