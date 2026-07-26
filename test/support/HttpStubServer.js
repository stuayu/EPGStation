'use strict';

const http = require('node:http');

class HttpStubServer {
    #requests = [];
    #server;

    constructor(handler = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
    }) {
        this.#server = http.createServer((request, response) => {
            const chunks = [];
            request.on('data', chunk => chunks.push(chunk));
            request.on('end', () => {
                this.#requests.push({
                    method: request.method,
                    url: request.url,
                    headers: request.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
                handler(request, response);
            });
        });
    }

    get requests() {
        return [...this.#requests];
    }

    async start() {
        await new Promise((resolve, reject) => {
            this.#server.once('error', reject);
            this.#server.listen(0, '127.0.0.1', resolve);
        });
        const address = this.#server.address();
        if (typeof address === 'string' || address === null) {
            throw new Error('HTTP stub did not bind to a TCP port');
        }
        return `http://127.0.0.1:${address.port}`;
    }

    async stop() {
        await new Promise((resolve, reject) => {
            this.#server.close(error => (error ? reject(error) : resolve()));
        });
    }
}

module.exports = { HttpStubServer };
