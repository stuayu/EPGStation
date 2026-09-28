'use strict';

const http = require('node:http');
const mirakurunDocs = {
    swagger: '2.0', basePath: '/api', paths: {
        '/programs/{id}/stream': { parameters: [], get: { operationId: 'getProgramStream', tags: ['stream'], parameters: [
            { name: 'id', in: 'path', required: true, type: 'integer' },
            { name: 'decode', in: 'query', type: 'boolean' },
        ] } },
        '/services/{id}/stream': { parameters: [], get: { operationId: 'getServiceStream', tags: ['stream'], parameters: [
            { name: 'id', in: 'path', required: true, type: 'integer' },
            { name: 'decode', in: 'query', type: 'boolean' },
        ] } },
    },
};

const tsPackets = (n, { pid = 0x100, cc = 0, conn = 0 } = {}) => {
    const packets = Buffer.alloc(n * 188, 0xff);
    for (let i = 0; i < n; i++) {
        const packet = packets.subarray(i * 188, (i + 1) * 188);
        packet[0] = 0x47;
        packet[1] = (pid >> 8) & 0x1f;
        packet[2] = pid & 0xff;
        packet[3] = 0x10 | ((cc + i) & 0x0f);
        packet.writeUInt32BE(conn >>> 0, 4);
        packet.writeUInt32BE(i >>> 0, 8);
    }
    return packets;
};

const sendThenReset = (nPackets, partialBytes, options = {}) => ({ type: 'sendThenReset', nPackets, partialBytes, ...options });
const sendThenEnd = (nPackets, options = {}) => ({ type: 'sendThenEnd', nPackets, ...options });
const sendAndHold = (nPackets = 0, options = {}) => ({ type: 'sendAndHold', nPackets, ...options });
const sendThenHold = (nPackets = 0, options = {}) => ({ type: 'sendThenHold', nPackets, ...options });
const status = code => ({ type: 'status', code });

class MirakurunRecordingStub {
    #server;
    #scripts;
    #requests = [];
    #held = new Set();

    constructor(scripts) {
        this.#scripts = [...scripts];
        this.#server = http.createServer((request, response) => {
            this.#requests.push({ method: request.method, url: request.url, priority: request.headers['x-mirakurun-priority'] });
            if (request.url === '/api/docs') {
                response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(mirakurunDocs));
                return;
            }
            if (!/^\/api\/(?:services|programs)\/\d+\/stream(?:\?|$)/.test(request.url)) {
                response.writeHead(404).end();
                return;
            }
            const script = this.#scripts.shift() ?? { type: 'status', code: 503 };
            if (script.type === 'status') {
                response.writeHead(script.code).end();
            } else if (script.type === 'sendThenReset') {
                response.writeHead(200, { 'content-type': 'video/mp2t' });
                response.write(tsPackets(script.nPackets, script), () => {
                    setTimeout(() => {
                        if (response.destroyed) return;
                        response.write(
                            tsPackets(1, { ...script, cc: (script.cc ?? 0) + script.nPackets }).subarray(0, script.partialBytes),
                            () => response.socket?.destroy(),
                        );
                    }, script.delayMs ?? 10);
                });
            } else if (script.type === 'sendThenEnd') {
                response.writeHead(200, { 'content-type': 'video/mp2t' });
                response.end(tsPackets(script.nPackets, script));
            } else if (script.type === 'sendThenHold') {
                response.writeHead(200, { 'content-type': 'video/mp2t' });
                response.write(tsPackets(script.nPackets ?? 0, script));
                this.#held.add(response);
                response.once('close', () => this.#held.delete(response));
                setTimeout(() => {
                    if (!response.destroyed) response.write(tsPackets(1, { ...script, cc: script.nPackets ?? 0 }));
                }, script.delayMs ?? 10);
            } else {
                response.writeHead(200, { 'content-type': 'video/mp2t' });
                this.#held.add(response);
                response.once('close', () => this.#held.delete(response));
                response.write(tsPackets(script.nPackets ?? 0, script));
            }
        });
    }

    get requests() { return [...this.#requests]; }

    async start() {
        await new Promise((resolve, reject) => {
            this.#server.once('error', reject);
            this.#server.listen(0, '127.0.0.1', resolve);
        });
        return `http://127.0.0.1:${this.#server.address().port}`;
    }

    async stop() {
        for (const response of this.#held) response.destroy();
        await new Promise(resolve => this.#server.close(() => resolve()));
    }
}

module.exports = { MirakurunRecordingStub, tsPackets, sendThenReset, sendThenEnd, sendAndHold, sendThenHold, status };
