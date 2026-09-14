'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const Fmp4Packager = require('../../dist/model/service/stream/llhls/Fmp4Packager').default;

// in-memory HLS でライブ / 録画を配信するために、ffmpeg が吐く fragmented mp4 を
// init セグメント・パート・セグメントへ切り分ける Writable のテスト。
// 実ファイルを使わずに済むよう、必要な box だけを最小構成で組み立てる。

const TRACK_ID = 1;
const TIMESCALE = 90000;

/**
 * ISO-BMFF の box を作る
 */
function box(type, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + body.length, 0);
    header.write(type, 4, 'latin1');

    return Buffer.concat([header, body]);
}

function makeFtyp() {
    return box('ftyp', Buffer.from('isom\x00\x00\x02\x00isomiso6', 'latin1'));
}

/**
 * trackId と timescale を読める最小の moov
 */
function makeMoov(trackId = TRACK_ID, timescale = TIMESCALE) {
    // tkhd (version 0): version+flags(4) / creation(4) / modification(4) / track_ID(4)
    const tkhd = Buffer.alloc(20);
    tkhd.writeUInt32BE(trackId, 12);

    // mdhd (version 0): version+flags(4) / creation(4) / modification(4) / timescale(4) / duration(4)
    const mdhd = Buffer.alloc(20);
    mdhd.writeUInt32BE(timescale, 12);

    const mdia = box('mdia', box('mdhd', mdhd));

    return box('moov', box('trak', Buffer.concat([box('tkhd', tkhd), mdia])));
}

/**
 * baseMediaDecodeTime を持つ moof
 */
function makeMoof(baseMediaDecodeTime, trackId = TRACK_ID) {
    // tfhd: version+flags(4) / track_ID(4)
    const tfhd = Buffer.alloc(8);
    tfhd.writeUInt32BE(trackId, 4);

    // tfdt (version 1): version+flags(4) / baseMediaDecodeTime(8)
    const tfdt = Buffer.alloc(12);
    tfdt.writeUInt8(1, 0);
    tfdt.writeBigUInt64BE(BigInt(baseMediaDecodeTime), 4);

    const traf = box('traf', Buffer.concat([box('tfhd', tfhd), box('tfdt', tfdt)]));

    return box('moof', traf);
}

function makeMdat(size = 32, fill = 0x41) {
    return box('mdat', Buffer.alloc(size, fill));
}

/**
 * ID3 timed metadata (AribId3Extractor が出すもの) を模した値
 */
function makeMetadata(pts, text) {
    return { pts, payload: Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x05', 'latin1'), Buffer.from(text)]) };
}

/**
 * トップレベル box を走査して指定した type の数を数える
 * (emsg の scheme_id_uri が 'emsg' を含むため、文字列検索では数えられない)
 */
function countBoxes(data, type) {
    let count = 0;
    let offset = 0;
    while (offset + 8 <= data.length) {
        const size = data.readUInt32BE(offset);
        if (size < 8) break;
        if (data.toString('latin1', offset + 4, offset + 8) === type) count++;
        offset += size;
    }

    return count;
}

/**
 * トップレベルの emsg box を hls.js と同じ解釈で取り出す
 * (version 1: timescale / presentation_time(64bit) / event_duration / id / scheme_id_uri / value / message_data)
 */
function parseEmsgBoxes(data) {
    const results = [];
    let offset = 0;
    while (offset + 8 <= data.length) {
        const size = data.readUInt32BE(offset);
        if (size < 8) break;
        if (data.toString('latin1', offset + 4, offset + 8) === 'emsg') {
            const body = data.subarray(offset + 8, offset + size);
            const version = body.readUInt8(0);
            let p = 4;
            const timescale = body.readUInt32BE(p);
            p += 4;
            const presentationTime = Number(body.readBigUInt64BE(p));
            p += 8;
            const eventDuration = body.readUInt32BE(p);
            p += 4;
            const id = body.readUInt32BE(p);
            p += 4;
            let end = body.indexOf(0, p);
            const schemeIdUri = body.toString('utf8', p, end);
            p = end + 1;
            end = body.indexOf(0, p);
            const value = body.toString('utf8', p, end);
            p = end + 1;
            results.push({
                version,
                timescale,
                presentationTime,
                eventDuration,
                id,
                schemeIdUri,
                value,
                payload: body.subarray(p),
            });
        }
        offset += size;
    }

    return results;
}

/**
 * packager にバイト列を書き込み、発生したイベントを集める
 */
async function run(chunks, option = {}, logger = null) {
    const packager = new Fmp4Packager(option, logger);
    const events = {
        init: [],
        part: [],
        segment: [],
        trailer: [],
        halted: [],
        multiTrack: [],
        trackInit: [],
        trackPart: [],
        trackSegment: [],
    };
    packager.on('init', value => events.init.push(value));
    packager.on('part', value => events.part.push(value));
    packager.on('segment', value => events.segment.push(value));
    packager.on('trailer', value => events.trailer.push(value));
    packager.on('halted', value => events.halted.push(value));
    packager.on('multiTrack', roles => events.multiTrack.push(roles));
    packager.on('trackInit', (role, data) => events.trackInit.push({ role, data }));
    packager.on('trackPart', (role, part) => events.trackPart.push({ role, part }));
    packager.on('trackSegment', (role, segment) => events.trackSegment.push({ role, segment }));

    for (const chunk of chunks) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    return { packager, events };
}

// ============================================================
// 複数音声トラック分解モード (multiTrack) 用のヘルパー
//
// ffmpeg が `-map 0:v:0 -map 0:a:0 -map 0:a:1` で 1 映像 + 2 音声を
// 1 本の fMP4 として出力した場合の moov/moof/mdat を模す。
// 実際に ffmpeg 9.0.1 (-movflags empty_moov+default_base_moof+frag_keyframe) の出力で
// 検証済みの構造 (1 moof に traf が複数、trun は data-offset-present +
// sample-size-present、base-data-offset は moof 開始) に合わせている
// ============================================================

function makeHdlr(handlerType) {
    const body = Buffer.alloc(4 + 4 + 4 + 12 + 1);
    body.write(handlerType, 8, 'latin1');

    return box('hdlr', body);
}

function makeMultiTrackMoov(tracks) {
    const mvhd = Buffer.alloc(4);
    const traks = [];
    const trexes = [];
    for (const t of tracks) {
        const tkhd = Buffer.alloc(20);
        tkhd.writeUInt32BE(t.trackId, 12);
        const mdhd = Buffer.alloc(20);
        mdhd.writeUInt32BE(t.timescale, 12);
        const mdia = box('mdia', Buffer.concat([box('mdhd', mdhd), makeHdlr(t.mediaType)]));
        traks.push(box('trak', Buffer.concat([box('tkhd', tkhd), mdia])));

        const trex = Buffer.alloc(24);
        trex.writeUInt32BE(t.trackId, 4);
        trexes.push(box('trex', trex));
    }
    const mvex = box('mvex', Buffer.concat(trexes));

    return box('moov', Buffer.concat([box('mvhd', mvhd), ...traks, mvex]));
}

/**
 * tfhd (version 0, flags = default-base-is-moof のみ)
 */
function makeTfhdSimple(trackId) {
    const body = Buffer.alloc(8);
    body.writeUIntBE(0x020000, 1, 3);
    body.writeUInt32BE(trackId, 4);

    return box('tfhd', body);
}

function makeTfdtV1(baseMediaDecodeTime) {
    const body = Buffer.alloc(12);
    body.writeUInt8(1, 0);
    body.writeBigUInt64BE(BigInt(baseMediaDecodeTime), 4);

    return box('tfdt', body);
}

/**
 * trun (data-offset-present + sample-size-present)。dataOffset は後から書き換える前提で
 * 一旦 0 を入れておき、呼び出し側が bodyStart+8 の位置を書き換える
 */
function makeTrunPlaceholder(sampleSizes) {
    const body = Buffer.alloc(8 + 4 + sampleSizes.length * 4);
    body.writeUIntBE(0x000201, 1, 3); // data-offset-present(0x1) + sample-size-present(0x200)
    body.writeUInt32BE(sampleSizes.length, 4);
    // body[8..12) = data_offset (後で書き換え)
    let offset = 12;
    for (const size of sampleSizes) {
        body.writeUInt32BE(size, offset);
        offset += 4;
    }

    return box('trun', body);
}

/**
 * 1 映像 + N 音声の moof + mdat を組み立てる。
 * ffmpeg 実測どおり、各トラックのサンプルはトラック順に mdat 内へ連結配置する
 * @param tracksSpec: { trackId, tfdt, sampleSizes, fill }[]
 * @return { moof: Buffer, mdat: Buffer }
 */
function makeMultiTrackFragment(tracksSpec) {
    const mfhd = box('mfhd', Buffer.alloc(8));

    // traf ごとに、trun の data_offset フィールドが traf 内のどこにあるか (実際のバッファ長から算出する。
    // ハードコードした box サイズはズレの温床になるため使わない)
    const trafParts = tracksSpec.map(t => {
        const tfhd = makeTfhdSimple(t.trackId);
        const tfdt = makeTfdtV1(t.tfdt);
        const trun = makeTrunPlaceholder(t.sampleSizes);
        // trun 内で data_offset フィールドが始まる相対位置 (version+flags(4) + sample_count(4) の後ろ)
        const dataOffsetOffsetInTrun = 8 + 4 + 4;
        const dataOffsetOffsetInTraf = 8 /* traf header */ + tfhd.length + tfdt.length + dataOffsetOffsetInTrun;
        const trafBody = Buffer.concat([tfhd, tfdt, trun]);

        return { trafBuf: box('traf', trafBody), dataOffsetOffsetInTraf };
    });

    const moofBody = Buffer.concat([mfhd, ...trafParts.map(p => p.trafBuf)]);
    const moof = box('moof', moofBody);

    // 各 traf の trun.data_offset (moof 開始からの相対位置) を書き換える。
    // ffmpeg 実測どおり、各トラックのサンプルは mdat 内でトラック順に連結配置される
    let cursor = 8 /* moof header */ + mfhd.length;
    let mdatCursor = moof.length + 8; // mdat の header 分
    for (let i = 0; i < trafParts.length; i++) {
        const fieldOffset = cursor + trafParts[i].dataOffsetOffsetInTraf;
        moof.writeInt32BE(mdatCursor, fieldOffset);

        mdatCursor += tracksSpec[i].sampleSizes.reduce((a, b) => a + b, 0);
        cursor += trafParts[i].trafBuf.length;
    }

    const mdatBody = Buffer.concat(
        tracksSpec.map(t => Buffer.alloc(t.sampleSizes.reduce((a, b) => a + b, 0), t.fill ?? t.trackId)),
    );

    return { moof, mdat: box('mdat', mdatBody) };
}

/**
 * 1 映像 (trackId=1) + audioCount 本の音声 (trackId=2,3,...) の moov + N フラグメントを作る
 */
function makeMultiTrackStream(audioCount, fragmentCount = 2) {
    const tracks = [{ trackId: 1, timescale: TIMESCALE, mediaType: 'vide' }];
    for (let i = 0; i < audioCount; i++) {
        tracks.push({ trackId: 2 + i, timescale: 48000, mediaType: 'soun' });
    }
    const moov = makeMultiTrackMoov(tracks);

    const chunks = [makeFtyp(), moov];
    for (let f = 0; f < fragmentCount; f++) {
        const spec = tracks.map((t, i) => ({
            trackId: t.trackId,
            tfdt: f * (t.mediaType === 'vide' ? TIMESCALE : 48000),
            sampleSizes: [20 + i, 21 + i],
            fill: 0x10 * (i + 1) + f,
        }));
        const { moof, mdat } = makeMultiTrackFragment(spec);
        chunks.push(moof, mdat);
    }

    return { tracks, chunks };
}

/**
 * トラックの init + パート列を連結し、moof/mdat を辿って mdat の総バイト数を数える
 * (取りこぼし・重複が無いことの検証用)
 */
function sumMdatBytes(data) {
    let sum = 0;
    let offset = 0;
    while (offset + 8 <= data.length) {
        const size = data.readUInt32BE(offset);
        if (size < 8) break;
        if (data.toString('latin1', offset + 4, offset + 8) === 'mdat') {
            sum += size - 8;
        }
        offset += size;
    }

    return sum;
}

test('音声トラックが 2 本以上あると multiTrack へ入り、ロールごとに init/part/segment を分ける', async () => {
    const { tracks, chunks } = makeMultiTrackStream(2, 2);
    const { events } = await run(chunks, { partsPerSegment: 2 });

    // 従来の init/part/segment は emit されない
    assert.equal(events.init.length, 0);
    assert.equal(events.part.length, 0);
    assert.equal(events.segment.length, 0);

    assert.equal(events.multiTrack.length, 1);
    assert.deepEqual(events.multiTrack[0], ['video', 'audio0', 'audio1']);

    assert.equal(events.trackInit.length, 3);
    assert.deepEqual(
        events.trackInit.map(e => e.role).sort(),
        ['audio0', 'audio1', 'video'],
    );

    // 2 フラグメント x 3 ロールぶんの part
    assert.equal(events.trackPart.length, 6);
    for (const role of ['video', 'audio0', 'audio1']) {
        const parts = events.trackPart.filter(e => e.role === role);
        assert.equal(parts.length, 2);
    }

    void tracks;
});

test('multiTrack のロールごとの mdat 合計バイト数が入力のサンプル合計と一致する (取りこぼし検証)', async () => {
    const { chunks } = makeMultiTrackStream(2, 3);
    const { events } = await run(chunks, { partsPerSegment: 3 });

    for (const role of ['video', 'audio0', 'audio1']) {
        const parts = events.trackPart.filter(e => e.role === role).map(e => e.part.data);
        const totalBytes = parts.reduce((sum, data) => sum + sumMdatBytes(data), 0);
        // makeMultiTrackFragment は各フラグメントで sampleSizes = [20+i, 21+i] (41+2i byte) を積む
        // (i は tracks 配列内でのインデックス: video=0, audio0=1, audio1=2)
        const index = role === 'video' ? 0 : role === 'audio0' ? 1 : 2;
        const perFragment = 20 + index + (21 + index);
        assert.equal(totalBytes, perFragment * 3);
    }
});

test('multiTrack でも emsg (ARIB 字幕) は video ロールのパートにのみ載る', async () => {
    const { chunks } = makeMultiTrackStream(2, 2);
    const packager = new Fmp4Packager({ partsPerSegment: 1 });
    const trackParts = [];
    packager.on('trackPart', (role, part) => trackParts.push({ role, part }));

    // ftyp + moov を書き込んだ直後 (最初のフラグメントより前) に字幕を積む
    packager.write(chunks[0]);
    packager.write(chunks[1]);
    packager.pushId3(makeMetadata(0, 'caption'));
    for (const chunk of chunks.slice(2)) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    const videoParts = trackParts.filter(e => e.role === 'video');
    const audioParts = trackParts.filter(e => e.role !== 'video');

    assert.equal(countBoxes(videoParts[0].part.data, 'emsg'), 1);
    for (const a of audioParts) {
        assert.equal(countBoxes(a.part.data, 'emsg'), 0);
    }
});

test('音声トラックが 1 本だけなら従来どおり (multiTrack へ入らない)', async () => {
    const { chunks } = makeMultiTrackStream(1, 2);
    const { events } = await run(chunks, { partsPerSegment: 2 });

    assert.equal(events.multiTrack.length, 0);
    assert.equal(events.trackInit.length, 0);
    assert.equal(events.init.length, 1);
    assert.equal(events.part.length, 2);
});

test('音声トラックが 3 本以上でも先頭 2 本 (audio0/audio1) のみ配信する', async () => {
    const { chunks } = makeMultiTrackStream(3, 1);
    const { events } = await run(chunks, { partsPerSegment: 1 });

    assert.deepEqual(events.multiTrack[0], ['video', 'audio0', 'audio1']);
    assert.equal(events.trackInit.length, 3);
});

/**
 * duration が 1 秒ずつ進む n 個の moof + mdat を作る
 */
function makeParts(count, secondsPerPart = 1) {
    const parts = [];
    for (let i = 0; i < count; i++) {
        parts.push(makeMoof(i * secondsPerPart * TIMESCALE), makeMdat(16 + i));
    }

    return parts;
}

test('ftyp + moov を init セグメントとして通知する', async () => {
    const ftyp = makeFtyp();
    const moov = makeMoov();
    const { events } = await run([ftyp, moov]);

    assert.equal(events.init.length, 1);
    assert.deepEqual(events.init[0], Buffer.concat([ftyp, moov]));
});

test('moof + mdat をパートにまとめ、tfdt の差分から継続時間を求める', async () => {
    const { events } = await run([makeFtyp(), makeMoov(), ...makeParts(3, 2)]);

    assert.equal(events.part.length, 3);
    // 先頭 2 つは次のパートの tfdt との差 (2 秒) から確定する
    assert.equal(events.part[0].duration, 2);
    assert.equal(events.part[1].duration, 2);
    // 末尾は差分を取れないので直近の継続時間を流用する
    assert.equal(events.part[2].duration, 2);
    // セグメント先頭のパートだけ独立 (キーフレーム境界) 扱いになる
    assert.deepEqual(
        events.part.map(p => p.isIndependent),
        [true, false, false],
    );
});

test('partsPerSegment ごとにセグメントを確定させる', async () => {
    const { events } = await run([makeFtyp(), makeMoov(), ...makeParts(4)], { partsPerSegment: 2 });

    assert.equal(events.segment.length, 2);
    for (const segment of events.segment) {
        assert.equal(segment.parts.length, 2);
        assert.equal(segment.duration, 2);
        assert.deepEqual(segment.data, Buffer.concat(segment.parts.map(p => p.data)));
    }
});

test('端数のセグメントもストリーム終端で出力する', async () => {
    const { events } = await run([makeFtyp(), makeMoov(), ...makeParts(3)], { partsPerSegment: 2 });

    assert.equal(events.segment.length, 2);
    assert.equal(events.segment[1].parts.length, 1);
});

test('partsPerSegment の指定が不正なら既定値を使う', async () => {
    const { events } = await run([makeFtyp(), makeMoov(), ...makeParts(3)], { partsPerSegment: 0 });

    // 既定は 3 パートで 1 セグメント
    assert.equal(events.segment.length, 1);
    assert.equal(events.segment[0].parts.length, 3);
});

test('録画済みモードでパートを公開しなくても ID3 の emsg をセグメントへ載せる', async () => {
    const packager = new Fmp4Packager({ partsPerSegment: 2, mode: 'recorded' });
    const segments = [];
    packager.on('segment', segment => segments.push(segment));
    // 録画済み HLS は #EXT-X-PART を公開しない。セグメントだけを受け取る経路を模す。
    packager.on('part', () => {});

    packager.write(makeFtyp());
    packager.write(makeMoov());
    packager.pushId3(makeMetadata(9000, 'first'));
    packager.pushId3(makeMetadata(18000, 'second'));
    for (const chunk of makeParts(2)) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    assert.equal(segments.length, 1);
    // emsg はパート先頭へ載り、セグメントの連結結果にも残る
    assert.equal(segments[0].data.toString('latin1', 4, 8), 'emsg');
    assert.equal(countBoxes(segments[0].data, 'emsg'), 2);
    assert.equal(segments[0].parts[0].data.toString('latin1', 4, 8), 'emsg');
    assert.equal(countBoxes(segments[0].parts[0].data, 'emsg'), 2);
    // セグメントはパートの単純連結 (emsg はパート側に含まれている)
    assert.deepEqual(segments[0].data, Buffer.concat(segments[0].parts.map(p => p.data)));
});

test('emsg は hls.js が解釈できる version 1 形式で、セグメントの tfdt を基準にした絶対時刻を持つ', async () => {
    const packager = new Fmp4Packager({ partsPerSegment: 1 });
    const segments = [];
    packager.on('segment', segment => segments.push(segment));

    packager.write(makeFtyp());
    packager.write(makeMoov());
    // 1 秒後に 2 件目の字幕が来る想定 (ID3 の PTS は 90kHz)
    packager.pushId3(makeMetadata(9000, 'first'));
    packager.pushId3(makeMetadata(99000, 'second'));
    // 先頭パートの tfdt を 2 秒 (= 180000) にして、0 起点でないことを確かめる
    for (const chunk of [makeMoof(2 * TIMESCALE), makeMdat(16), makeMoof(4 * TIMESCALE), makeMdat(17)]) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    const emsgs = parseEmsgBoxes(segments[0].data);
    assert.equal(emsgs.length, 2);
    for (const emsg of emsgs) {
        assert.equal(emsg.version, 1);
        assert.equal(emsg.schemeIdUri, 'https://aomedia.org/emsg/ID3');
        assert.equal(emsg.value, '');
        assert.equal(emsg.timescale, TIMESCALE);
        assert.equal(emsg.eventDuration, 0xffffffff);
        assert.equal(emsg.payload.toString('latin1', 0, 3), 'ID3');
    }
    // 1 件目はセグメント先頭の tfdt そのもの、2 件目はそこから 1 秒後
    assert.equal(emsgs[0].presentationTime, 2 * TIMESCALE);
    assert.equal(emsgs[1].presentationTime, 3 * TIMESCALE);
    // id はセグメントをまたいでユニークになる
    assert.notEqual(emsgs[0].id, emsgs[1].id);
});

test('相対PTSの字幕はreaderが先に到着しても最初の映像partを基準にする', async () => {
    const packager = new Fmp4Packager({ partsPerSegment: 1 });
    const segments = [];
    packager.on('segment', segment => segments.push(segment));

    packager.write(makeFtyp());
    packager.write(makeMoov());
    // 先頭partを先に確定し、字幕readerのデータが映像より後から届く状態を作る。
    packager.write(makeMoof(0));
    packager.write(makeMdat(16));
    packager.write(makeMoof(TIMESCALE));
    packager.write(makeMdat(17));
    packager.pushId3(makeMetadata(TIMESCALE, 'relative'), true);
    packager.write(makeMoof(2 * TIMESCALE));
    packager.write(makeMdat(18));
    await new Promise(resolve => packager.end(resolve));

    const emsgs = parseEmsgBoxes(segments[1].data);
    assert.equal(emsgs.length, 1);
    assert.equal(emsgs[0].presentationTime, TIMESCALE);
});

test('セグメントが出力されないまま溜まった ID3 は上限で捨てる', async () => {
    const packager = new Fmp4Packager({ partsPerSegment: 1 });
    const segments = [];
    packager.on('segment', segment => segments.push(segment));

    packager.write(makeFtyp());
    packager.write(makeMoov());
    // 上限 (100 件) を超えて積む
    for (let i = 0; i < 150; i++) {
        packager.pushId3(makeMetadata(i * 90, `subtitle-${i}`));
    }
    for (const chunk of makeParts(1)) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    assert.equal(segments.length, 1);
    const emsgCount = countBoxes(segments[0].data, 'emsg');
    assert.equal(emsgCount, 100);
});

test('分割して届いた box を組み立て直す', async () => {
    const whole = Buffer.concat([makeFtyp(), makeMoov(), ...makeParts(2)]);
    const chunks = [];
    // 7 byte ずつに刻んで書き込む (box ヘッダの途中で切れる)
    for (let i = 0; i < whole.length; i += 7) {
        chunks.push(whole.subarray(i, i + 7));
    }

    const { events } = await run(chunks, { partsPerSegment: 2 });

    assert.equal(events.init.length, 1);
    assert.equal(events.part.length, 2);
    assert.equal(events.segment.length, 1);
});

test('最後のパートより後ろに残った box は trailer として通知する', async () => {
    const mfra = box('mfra', Buffer.alloc(8, 0x00));
    const { events } = await run([makeFtyp(), makeMoov(), ...makeParts(1), mfra], { partsPerSegment: 1 });

    assert.equal(events.trailer.length, 1);
    assert.deepEqual(events.trailer[0], mfra);
});

test('壊れた入力を検出したら halted を通知して解析を打ち切る', async () => {
    // box サイズがヘッダ長より小さい不正な box
    const broken = Buffer.alloc(8);
    broken.writeUInt32BE(3, 0);
    broken.write('junk', 4, 'latin1');

    const { events, packager } = await run([makeFtyp(), makeMoov(), broken, ...makeParts(1)]);

    assert.equal(events.halted.length, 1);
    assert.equal(typeof events.halted[0], 'string');
    // 打ち切り後は pushId3 を受け付けない
    packager.pushId3(makeMetadata(0, 'ignored'));
});

test('書き込まれた総バイト数を数える (取りこぼし検証用)', async () => {
    const chunks = [makeFtyp(), makeMoov(), ...makeParts(2)];
    const { packager } = await run(chunks, { partsPerSegment: 2 });

    assert.equal(
        packager.getTotalInputBytes(),
        chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
});

test('moof を伴わない mdat は破棄する', async () => {
    const logs = [];
    const logger = {
        stream: {
            info: () => {},
            warn: message => logs.push(message),
            error: () => {},
            debug: () => {},
        },
    };

    const { events } = await run([makeFtyp(), makeMoov(), makeMdat()], {}, logger);

    assert.equal(events.part.length, 0);
    assert.equal(
        logs.some(message => message.includes('mdat')),
        true,
    );
});
