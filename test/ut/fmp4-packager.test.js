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
    const events = { init: [], part: [], segment: [], trailer: [], halted: [] };
    for (const name of Object.keys(events)) {
        packager.on(name, value => events[name].push(value));
    }

    for (const chunk of chunks) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    return { packager, events };
}

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

test('pushId3 した ARIB 字幕をセグメント先頭の emsg box として多重化する', async () => {
    const packager = new Fmp4Packager({ partsPerSegment: 2 });
    const segments = [];
    packager.on('segment', segment => segments.push(segment));

    packager.write(makeFtyp());
    packager.write(makeMoov());
    packager.pushId3(makeMetadata(9000, 'first'));
    packager.pushId3(makeMetadata(18000, 'second'));
    for (const chunk of makeParts(2)) {
        packager.write(chunk);
    }
    await new Promise(resolve => packager.end(resolve));

    assert.equal(segments.length, 1);
    // emsg は 2 件分がパートの前 (セグメント先頭) に置かれる
    assert.equal(segments[0].data.toString('latin1', 4, 8), 'emsg');
    assert.equal(countBoxes(segments[0].data, 'emsg'), 2);
    assert.ok(segments[0].data.length > Buffer.concat(segments[0].parts.map(p => p.data)).length);
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
