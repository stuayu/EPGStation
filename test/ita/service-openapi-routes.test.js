'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const openapi = require('express-openapi');
const yaml = require('js-yaml');
const { test } = require('node:test');
const SocketIOManageModel = require('../../dist/model/service/socketio/SocketIOManageModel').default;

test('api.yml の全 API ルートを dist から初期化でき、定義済みの全メソッドが登録される', async () => {
    const apiDoc = yaml.load(fs.readFileSync(path.join(__dirname, '../../api.yml'), 'utf8'));
    apiDoc.servers = [{ url: '/api' }];
    const app = express();

    await openapi.initialize({
        apiDoc,
        app,
        docsPath: '/docs',
        consumesMiddleware: {
            'application/json': express.json({ limit: '20mb' }),
            'text/text': express.text(),
            'multipart/form-data': (_req, _res, next) => next(),
        },
        errorMiddleware: (err, _req, res, _next) => res.status(400).json(err),
        errorTransformer: openApi => ({ message: openApi.message ?? 'OpenAPI validation error' }),
        exposeApiDocs: true,
        paths: path.join(__dirname, '../../dist/model/service/api'),
    });

    const registered = new Set();
    for (const layer of app.router.stack) {
        if (!layer.route) continue;
        const routePath = layer.route.path.replace(/\/$/, '') || '/';
        for (const method of Object.keys(layer.route.methods)) {
            registered.add(`${method.toUpperCase()} ${routePath}`);
        }
    }

    const missing = [];
    for (const [apiPath, pathItem] of Object.entries(apiDoc.paths)) {
        const routePath = `/api${apiPath.replace(/\{([^}]+)\}/g, ':$1')}`;
        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']) {
            if (pathItem[method] && !registered.has(`${method.toUpperCase()} ${routePath}`)) {
                missing.push(`${method.toUpperCase()} ${routePath}`);
            }
        }
    }

    assert.deepEqual(missing, [], `api.yml の定義に対して Express へ未登録: ${missing.join(', ')}`);
});

test('番組リマインダーのログに通知先数と実際の Socket.IO 配信数を記録する', () => {
    const messages = [];
    const model = new SocketIOManageModel(
        { getLogger: () => ({ system: { info: message => messages.push(message) } }) },
        { getConfig: () => ({}) },
    );
    let delivered = 0;
    model.ios = [
        {
            sockets: {
                sockets: new Map([
                    ['client-1', { data: { userId: 7 }, emit: () => delivered++ }],
                    ['client-2', { data: { userId: 9 }, emit: () => delivered++ }],
                ]),
            },
        },
    ];

    model.notifyProgramStarting(
        { programId: 42, channelId: 3, name: '試験番組', startAt: 1000, minutesBefore: 5 },
        7,
        2,
    );

    assert.equal(delivered, 1);
    assert.match(messages[0], /programId: 42/);
    assert.match(messages[0], /name: 試験番組/);
    assert.match(messages[0], /minutesBefore: 5/);
    assert.match(messages[0], /notificationTargets: 2/);
    assert.match(messages[0], /socketClients: 1/);
});
