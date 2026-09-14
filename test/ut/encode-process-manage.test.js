'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const EncodeProcessManageModel = require('../../dist/model/service/encode/EncodeProcessManageModel').default;
const Fmp4Packager = require('../../dist/model/service/stream/llhls/Fmp4Packager').default;
const ProcessUtil = require('../../dist/util/ProcessUtil').default;

const box = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + body.length, 0);
    header.write(type, 4, 'latin1');

    return Buffer.concat([header, body]);
};

const makeFtyp = () => box('ftyp', Buffer.from('isom\x00\x00\x02\x00isomiso6', 'latin1'));

const makeMoov = () => {
    const tkhd = Buffer.alloc(20);
    tkhd.writeUInt32BE(1, 12);
    const mdhd = Buffer.alloc(20);
    mdhd.writeUInt32BE(90000, 12);

    return box('moov', box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', box('mdhd', mdhd))])));
};

const logger = {
    getLogger: () => ({ encode: { info: () => {}, error: () => {} } }),
};

test('閉じた子プロセス stdin の EPIPE がプロセスへ漏れない', async () => {
    const stdin = new PassThrough();
    ProcessUtil.attachStdinErrorHandler(stdin);
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    let uncaught = null;
    const uncaughtHandler = value => {
        uncaught = value;
    };
    process.once('uncaughtException', uncaughtHandler);
    stdin.destroy(error);
    await new Promise(resolve => setImmediate(resolve));
    process.removeListener('uncaughtException', uncaughtHandler);
    assert.equal(uncaught, null);
    assert.equal(stdin.destroyed, true);
});

test('字幕 reader の probe 待ち中も配信 stdout の ftyp/moov を Fmp4Packager が先頭から受け取る', async () => {
    const input = Buffer.concat([makeFtyp(), makeMoov()]);
    const script = [
        `const b=Buffer.from(${JSON.stringify(input.toString('base64'))},'base64');`,
        'let i=0;',
        "const t=setInterval(()=>{if(i>=b.length){clearInterval(t);return;}process.stdout.write(b.subarray(i,i+3));i+=3;},1);",
    ].join('');
    const scriptBase64 = Buffer.from(script).toString('base64');
    const model = new EncodeProcessManageModel(logger, { getConfig: () => ({ encodeProcessNum: 1 }) });
    const nodeProcess = await model.create({
        input: null,
        output: null,
        cmd: `${globalThis.process.execPath} -e eval(Buffer.from(process.argv[1],'base64').toString()) ${scriptBase64}`,
        priority: 0,
        // startEncodedTsSubtitleReader() の probe が遅れても stdout を捨てない。
        drainStdout: false,
    });

    // 別 reader の probe を模擬。ここで stdout を読むと主 fMP4 の先頭が失われる。
    await new Promise(resolve => setTimeout(resolve, 25));

    const packager = new Fmp4Packager({ partsPerSegment: 1 });
    const init = new Promise(resolve => packager.once('init', resolve));
    nodeProcess.stdout.pipe(packager);
    const initData = await init;
    assert.equal(initData.subarray(4, 8).toString('latin1'), 'ftyp');
    assert.equal(initData.subarray(makeFtyp().length + 4, makeFtyp().length + 8).toString('latin1'), 'moov');

    await once(nodeProcess, 'exit');
    packager.destroy();
});
