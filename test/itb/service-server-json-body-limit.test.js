'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const ServiceServer = require('../../dist/model/service/ServiceServer').default;

/**
 * SNS 投稿 (`POST /api/sns/post`) は画像を data URL (base64) で JSON ボディへ詰めて送るため、
 * express.json() の既定上限 (100kb) のままだと 1 枚のキャプチャ (最大 1.9MB 相当、base64 で
 * 約 2.5MB) すら収まらず必ず 413 Payload Too Large になる (実機で確認した実際の不具合)。
 * ServiceServer が実際に使っている limit 設定 (`ServiceServer.JSON_BODY_LIMIT`) をそのまま
 * express.json() へ渡し、100kb を超えるボディが通ることを確認する
 */
function startServer(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

function stopServer(server) {
    return new Promise(done => server.close(() => done()));
}

test('ServiceServer.JSON_BODY_LIMIT は express の既定上限 (100kb) より十分大きい (画像 4 枚 + text を想定)', () => {
    // 4 枚 * 約 2.5MB (base64) 分の余裕が無いと SNS 投稿の画像添付が必ず失敗する
    const bytesModule = require('bytes');
    const limitBytes = bytesModule.parse(ServiceServer.JSON_BODY_LIMIT);
    assert.ok(limitBytes >= 10 * 1024 * 1024, `JSON_BODY_LIMIT (${ServiceServer.JSON_BODY_LIMIT}) is too small`);
});

test('express.json({ limit: ServiceServer.JSON_BODY_LIMIT }) は 100kb を超える JSON ボディを受理する', async () => {
    const app = express();
    app.use(express.json({ limit: ServiceServer.JSON_BODY_LIMIT }));
    app.post('/echo', (req, res) => {
        res.status(200).json({ receivedLength: JSON.stringify(req.body).length });
    });

    const { server, port } = await startServer(app);
    try {
        // 104kb 程度の base64 文字列 (express.json() の既定 100kb 上限を超える)
        const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(104_000);
        const body = JSON.stringify({ accountIds: [1], text: '', images: [{ dataUrl: bigDataUrl }] });

        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
        });

        assert.equal(response.status, 200);
        const json = await response.json();
        assert.equal(json.receivedLength, body.length);
    } finally {
        await stopServer(server);
    }
});

test('express.json() の既定設定 (limit 未指定) だと同じボディが 413 になる (回帰確認: 既定のままでは今回の不具合が再現する)', async () => {
    const app = express();
    app.use(express.json());
    app.post('/echo', (req, res) => {
        res.status(200).json({ receivedLength: JSON.stringify(req.body).length });
    });

    const { server, port } = await startServer(app);
    try {
        const bigDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(104_000);
        const body = JSON.stringify({ accountIds: [1], text: '', images: [{ dataUrl: bigDataUrl }] });

        const response = await fetch(`http://127.0.0.1:${port}/echo`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
        });

        assert.equal(response.status, 413);
    } finally {
        await stopServer(server);
    }
});
