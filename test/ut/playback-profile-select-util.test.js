const test = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveSelectedPlaybackProfileId,
    resolvePlaybackSelection,
    resolvePlaybackContainer,
} = require('../../dist/util/PlaybackProfileSelectUtil');

// 実サーバの録画 HEVC (tsreplace) の playback-options と同じ並び: auto / オリジナル HEVC / 1080p がいずれも hls の mode 0
const profiles = [
    { id: 'auto', modes: { hls: 0, m2tsll: 0 } },
    { id: 'original-hevc', role: 'original-hevc', modes: { original: 0, hls: 0 } },
    { id: 'recorded-encoded-hls-1080p-avc', modes: { hls: 0 } },
    { id: 'recorded-encoded-hls-720p-avc', modes: { hls: 1 } },
];

test('選択中のプロファイルが同じ mode を持つなら、先頭一致ではなく選択中を返す', () => {
    assert.equal(resolveSelectedPlaybackProfileId(profiles, 'original-hevc', 'hls', 0), 'original-hevc');
    assert.equal(resolveSelectedPlaybackProfileId(profiles, 'recorded-encoded-hls-1080p-avc', 'hls', 0), 'recorded-encoded-hls-1080p-avc');
});

test('選択中が「おまかせ」ならそのまま auto を返す (サーバは auto を mode で解決する)', () => {
    assert.equal(resolveSelectedPlaybackProfileId(profiles, 'auto', 'hls', 0), 'auto');
});

test('選択中がその mode を持たない・未選択なら profile を渡さない (サーバが config の mode で解決する)', () => {
    assert.equal(resolveSelectedPlaybackProfileId(profiles, 'original-hevc', 'hls', 1), undefined);
    assert.equal(resolveSelectedPlaybackProfileId(profiles, null, 'hls', 0), undefined);
    assert.equal(resolveSelectedPlaybackProfileId(profiles, 'auto', 'webm', 0), undefined);
});

test('HEVC のオリジナル選択は HLS profile の URL へ正規化する', () => {
    assert.deepEqual(resolvePlaybackSelection(profiles, 'original-hevc', 'original', 0), {
        streamingType: 'hls',
        mode: 0,
        profile: 'original-hevc',
    });
});

test('MPEG-2 のオリジナル選択は original API のまま profile を渡す', () => {
    const mpeg2Profiles = [{ id: 'original-mpeg2', role: 'original-mpeg2', modes: { original: 0 } }];
    assert.deepEqual(resolvePlaybackSelection(mpeg2Profiles, 'original-mpeg2', 'original', 0), {
        streamingType: 'original',
        mode: 0,
        profile: 'original-mpeg2',
    });
});

test('オリジナル方式の profile 実体を DPlayer の切替先へ正規化する', () => {
    assert.equal(resolvePlaybackContainer('original', 'original-hevc'), 'hls');
    assert.equal(resolvePlaybackContainer('original', 'original-mpeg2'), 'original');
});
