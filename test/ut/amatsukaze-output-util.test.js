'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AmatsukazeOutputUtil = require('../../dist/model/amatsukaze/AmatsukazeOutputUtil').default;

// Amatsukaze のバージョンによっては完了しても ActualDstPath (実際の出力パス) が返らず、
// 拡張子の付かない DstPath しか得られない。出力先には本編と同じベース名で
// 字幕 (.ass) やチャプター (.chapter.txt) も並ぶため、本編だけを選ぶ必要がある。

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-amatsukaze-out-'));

const writeFile = (name, size) => {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, Buffer.alloc(size));

    return filePath;
};

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ベース名から本編だけを選び、副産物は無視する', () => {
    const base = path.join(tmpDir, 'program');
    const video = writeFile('program.hevc.ts', 4096);
    writeFile('program.hevc.chapter.txt', 128);
    writeFile('program.hevc.ass', 256);
    writeFile('program.log', 64);

    assert.equal(AmatsukazeOutputUtil.findOutputByBase(base), video);
});

test('ベース名が前方一致する別の録画は拾わない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-amatsukaze-out2-'));
    const target = path.join(dir, 'program #1');
    fs.writeFileSync(path.join(dir, 'program #1.hevc.ts'), Buffer.alloc(1024));
    // ベース名の直後が "." でないものは別の録画
    fs.writeFileSync(path.join(dir, 'program #10.hevc.ts'), Buffer.alloc(8192));

    assert.equal(AmatsukazeOutputUtil.findOutputByBase(target), path.join(dir, 'program #1.hevc.ts'));

    fs.rmSync(dir, { recursive: true, force: true });
});

test('本編候補が複数あるときは大きい方を採る', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-amatsukaze-out3-'));
    fs.writeFileSync(path.join(dir, 'program.mp4'), Buffer.alloc(1024));
    fs.writeFileSync(path.join(dir, 'program.hevc.ts'), Buffer.alloc(9999));

    assert.equal(AmatsukazeOutputUtil.findOutputByBase(path.join(dir, 'program')), path.join(dir, 'program.hevc.ts'));

    fs.rmSync(dir, { recursive: true, force: true });
});

test('該当するファイルが無ければ null', () => {
    assert.equal(AmatsukazeOutputUtil.findOutputByBase(path.join(tmpDir, 'notfound')), null);
});

test('存在しないディレクトリでも例外にせず null を返す', () => {
    assert.equal(AmatsukazeOutputUtil.findOutputByBase(path.join(tmpDir, 'no', 'such', 'dir', 'base')), null);
});
