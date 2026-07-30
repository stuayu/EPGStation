#!/usr/bin/env node
'use strict';

/**
 * ビルド成果物 (dist) を削除する。
 *
 * `fs.rmSync('dist', { recursive: true })` で丸ごと消すと、Windows では次の理由で
 * EPERM になることがある。
 *
 *   - node-windows は winsw の実行ファイル (<サービス名>.exe) と設定を
 *     「サービスとして起動するスクリプトのディレクトリ + /daemon」へ置く。
 *     script が dist/index.js の場合、これは dist/daemon になり、
 *     実行中のサービス本体を消そうとして失敗する
 *   - ウイルス対策ソフトや Windows Search がファイルを掴んでいることがある
 *
 * ディレクトリ自体は残して中身だけを消し、消せなかったものは警告にとどめる。
 * tsc は同名ファイルを上書きするため、消し残しがあってもビルドは通る。
 */

const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');

// 削除しないもの (サービスの実体。消すとサービス登録が壊れる)
const KEEP = new Set(['daemon']);

if (fs.existsSync(distPath) === false) {
    process.exit(0);
}

const skipped = [];
for (const entry of fs.readdirSync(distPath)) {
    if (KEEP.has(entry) === true) {
        continue;
    }

    try {
        fs.rmSync(path.join(distPath, entry), { recursive: true, force: true });
    } catch (err) {
        skipped.push(`${entry} (${err.code ?? err.message})`);
    }
}

if (skipped.length > 0) {
    console.warn(`[clean] 削除できなかったファイルがあります: ${skipped.join(', ')}`);
    console.warn('[clean] 使用中のファイルの可能性があります。ビルドは続行します');
}
