const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 直接配信 (レスポンスへ stream を pipe する) ルートは、StreamBaseModel の停止タイマー (15 秒) を
// サーバ側で keep し続けないと配信が途中で切れる。HLS はクライアントが keep API を呼ぶので対象外。
// 実例: ライブのオリジナル (MPEG-2) が keep を持たず、再生開始から 15 秒で必ず止まっていた。
const root = path.join(__dirname, '../../src/model/service/api/streams');

test('ライブ・録画の直接配信ルートはすべて keep を呼ぶ', () => {
    const missing = [];
    for (const scope of ['live/{channelId}', 'recorded/{videoFileId}']) {
        const dir = path.join(root, scope);
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.ts') || file === 'hls.ts' || file === 'playback-options.ts') continue;
            const source = fs.readFileSync(path.join(dir, file), 'utf8');
            if (source.includes('.pipe(res)') && /\.keep\(/u.test(source) === false) missing.push(`${scope}/${file}`);
        }
    }
    assert.deepEqual(missing, []);
});
