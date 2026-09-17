'use strict';

/**
 * Service Worker が扱う要求の分類。
 * 純粋関数にして、API や WebSocket をキャッシュ経路へ入れない契約を固定する。
 */
const classifyServiceWorkerRequest = (request, scopeUrl) => {
    if (request.method !== 'GET') return 'passthrough';

    const scope = new URL(scopeUrl);
    const url = new URL(request.url, scope);
    if (url.origin !== scope.origin || url.pathname.startsWith(scope.pathname) === false) return 'passthrough';

    const relativePath = url.pathname.slice(scope.pathname.length).replace(/^\/+|\/+$/gu, '');
    if (relativePath === 'local/offline' || relativePath.startsWith('local/offline/')) return 'offline';

    // API、配信、socket.io、データ放送/SNS WebSocket は常にネットワークへ渡す。
    if (
        relativePath === 'api' ||
        relativePath.startsWith('api/') ||
        relativePath === 'streamfiles' ||
        relativePath.startsWith('streamfiles/') ||
        relativePath === 'socket.io' ||
        relativePath.startsWith('socket.io/')
    ) {
        return 'passthrough';
    }

    if (request.mode === 'navigate') return 'navigation';

    // Vite のハッシュ付き assets と、index.html から参照する静的ファイルだけを対象にする。
    if (
        relativePath.startsWith('assets/') ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'font' ||
        request.destination === 'image' ||
        request.destination === 'manifest'
    ) {
        return 'asset';
    }

    return 'passthrough';
};

/** Range ヘッダーをファイル長に対して解決する。 */
const resolveOfflineByteRange = (header, fileSize) => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return { kind: 'unsatisfiable' };
    if (header === undefined || header === null || (typeof header === 'string' && header.trim() === '')) {
        return { kind: 'full', start: 0, end: fileSize - 1 };
    }
    const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
    if (match === null || (match[1] === '' && match[2] === '')) return { kind: 'unsatisfiable' };
    if (match[1] === '') {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'unsatisfiable' };
        return { kind: 'partial', start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
    }
    const start = Number(match[1]);
    const requestedEnd = match[2] === '' ? fileSize - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= fileSize || start > requestedEnd || requestedEnd >= fileSize) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start, end: requestedEnd };
};

/** 指定 Range と交差する保存チャンクの読み出し範囲を求める。 */
const getOfflineChunkSlices = (range, chunkSize, fileSize, sourceOffset = 0) => {
    if (range === undefined || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(fileSize) || fileSize <= 0) return [];
    if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0) return [];
    const actualFileSize = sourceOffset + fileSize;
    const slices = [];
    const firstChunk = Math.floor((sourceOffset + range.start) / chunkSize);
    const lastChunk = Math.floor((sourceOffset + range.end) / chunkSize);
    for (let chunk = firstChunk; chunk <= lastChunk; chunk += 1) {
        const chunkStart = chunk * chunkSize;
        const chunkEnd = Math.min(actualFileSize - 1, chunkStart + chunkSize - 1);
        const sliceStart = Math.max(sourceOffset + range.start, chunkStart);
        const sliceEnd = Math.min(sourceOffset + range.end, chunkEnd);
        slices.push({ chunkStart, offset: sliceStart - chunkStart, length: sliceEnd - sliceStart + 1 });
    }
    return slices;
};

/** 保存チャンクを Service Worker の ReadableStream へ渡す小さな単位へ分割する。 */
const splitOfflineResponseChunkRanges = (length, maxChunkSize) => {
    if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(maxChunkSize) || maxChunkSize <= 0) return [];
    const ranges = [];
    for (let offset = 0; offset < length; offset += maxChunkSize) {
        ranges.push({ offset, length: Math.min(maxChunkSize, length - offset) });
    }
    return ranges;
};

/** SW が返すオフライン MPEG-TS 応答の status / headers / チャンク範囲を組み立てる。 */
const createOfflineRangePlan = (header, fileSize, chunkSize, sourceOffset = 0) => {
    const range = resolveOfflineByteRange(header, fileSize);
    if (range.kind === 'unsatisfiable') {
        return { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${fileSize}` }, slices: [] };
    }
    const slices = getOfflineChunkSlices(range, chunkSize, fileSize, sourceOffset);
    return {
        status: range.kind === 'full' ? 200 : 206,
        headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1),
            // Content-Range は部分応答 (206) のときだけ付ける (RFC 9110)。200 に付けると実装によっては部分応答と誤認する
            ...(range.kind === 'full' ? {} : { 'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}` }),
        },
        slices,
        start: range.start,
        end: range.end,
    };
};

/** オフライン元 TS の offset を TS パケット境界へ揃え、再生可能な末尾へクランプする。 */
const resolveOfflineOriginalOffset = (value, fileSize, packetSize = 188) => {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || !Number.isSafeInteger(packetSize) || packetSize <= 0) return 0;
    const requested = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : Number(value);
    if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
    const aligned = Math.floor(requested / packetSize) * packetSize;
    return Math.min(aligned, Math.max(0, fileSize - packetSize));
};

/** offset 後を独立ファイルとみなしたオフライン元 TS の応答計画を作る。 */
const createOfflineOriginalRangePlan = (header, offset, fileSize, chunkSize, packetSize = 188) => {
    const sourceOffset = resolveOfflineOriginalOffset(offset, fileSize, packetSize);
    return {
        offset: sourceOffset,
        ...createOfflineRangePlan(header, fileSize - sourceOffset, chunkSize, sourceOffset),
    };
};

if (typeof module !== 'undefined' && module.exports !== undefined) {
    module.exports = {
        classifyServiceWorkerRequest,
        resolveOfflineByteRange,
        getOfflineChunkSlices,
        splitOfflineResponseChunkRanges,
        createOfflineRangePlan,
        resolveOfflineOriginalOffset,
        createOfflineOriginalRangePlan,
    };
}
