'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_SCHEMA } = require('../../dist/model/config/ConfigSchema');
const { CONFIG_OVERLAY_KEYS } = require('../../dist/model/config/ConfigOverlay');

// ConfigSchema (単一の定義元) と IConfigFile / ConfigOverlay の間に取りこぼしが無いかを
// 機械的に確認する。
//
// ConfigSchemaEntry.key: keyof IConfigFile という型制約は
// 「schema にあるキーは IConfigFile に存在する」という片方向しか保証しない。
// IConfigFile にキーを追加して schema へ足し忘れても型エラーにもテスト失敗にもならず、
// これは今回のリファクタで解消したかった「追加漏れ」そのものなので、双方向の一致を
// ここで検証する。

const configFilePath = path.join(__dirname, '../../src/model/IConfigFile.ts');
const configFileSource = fs.readFileSync(configFilePath, 'utf8');

/**
 * IConfigFile.ts のソースから `export default interface IConfigFile { ... }` の
 * トップレベルメンバー名だけを抜き出す。
 * ネストしたインターフェース (HttpsConfig 等) のメンバーを誤って拾わないよう、
 * `interface IConfigFile {` の開き波括弧から対応する閉じ波括弧までをブレース深度で
 * 追跡し、深度 0 の行だけをキー候補として見る (安易な正規表現全文検索は
 * ネストしたオブジェクト型のプロパティも拾ってしまい誤判定するため避ける)。
 */
function extractIConfigFileTopLevelKeys(source) {
    const startMarker = 'export default interface IConfigFile {';
    const startIdx = source.indexOf(startMarker);
    assert.ok(startIdx >= 0, 'IConfigFile.ts に export default interface IConfigFile が見つからない');

    let i = startIdx + startMarker.length;
    let depth = 1;
    let body = '';
    while (depth > 0) {
        const c = source[i];
        assert.ok(typeof c === 'string', 'IConfigFile.ts の波括弧の対応が取れず、ファイル末尾に達した');
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) break;
        }
        body += c;
        i++;
    }

    const keys = [];
    let lineDepth = 0;
    for (const line of body.split('\n')) {
        if (lineDepth === 0) {
            const m = line.match(/^\s*([a-zA-Z0-9_]+)\??\s*:/);
            if (m !== null) keys.push(m[1]);
        }
        const opens = (line.match(/{/g) ?? []).length;
        const closes = (line.match(/}/g) ?? []).length;
        lineDepth += opens - closes;
    }
    return keys;
}

const iConfigFileKeys = extractIConfigFileTopLevelKeys(configFileSource);
const schemaKeys = CONFIG_SCHEMA.map(entry => entry.key);

test('IConfigFile のトップレベルキーが全件 CONFIG_SCHEMA に存在する', () => {
    const missing = iConfigFileKeys.filter(key => !schemaKeys.includes(key));
    assert.deepEqual(missing, [], `IConfigFile にあるが CONFIG_SCHEMA に無いキー: ${missing.join(', ')}`);
});

test('CONFIG_SCHEMA のキーが全件 IConfigFile に存在する (逆方向)', () => {
    const extra = schemaKeys.filter(key => !iConfigFileKeys.includes(key));
    assert.deepEqual(extra, [], `CONFIG_SCHEMA にあるが IConfigFile に無いキー: ${extra.join(', ')}`);
});

test('IConfigFile と CONFIG_SCHEMA のトップレベルキー集合が完全一致する (件数含む)', () => {
    assert.equal(
        schemaKeys.length,
        iConfigFileKeys.length,
        `キー数が一致しない (IConfigFile: ${iConfigFileKeys.length}, CONFIG_SCHEMA: ${schemaKeys.length})`,
    );
});

test('CONFIG_OVERLAY_KEYS は CONFIG_SCHEMA の editable === "gui" 集合と一致する', () => {
    const guiKeys = CONFIG_SCHEMA.filter(entry => entry.editable === 'gui').map(entry => entry.key);
    assert.deepEqual(
        [...CONFIG_OVERLAY_KEYS].sort(),
        [...guiKeys].sort(),
        'CONFIG_OVERLAY_KEYS と CONFIG_SCHEMA の editable === "gui" エントリがずれている',
    );
});

test('editable === "ymlOnly" のエントリには必ず reason がある', () => {
    const missingReason = CONFIG_SCHEMA.filter(entry => entry.editable === 'ymlOnly' && !entry.reason).map(
        entry => entry.key,
    );
    assert.deepEqual(missingReason, [], `reason が無い ymlOnly エントリ: ${missingReason.join(', ')}`);
});

test('editable === "gui" のエントリは fields か customEditor のどちらかを持つ (分類漏れガード)', () => {
    // editable: 'gui' かつ fields が空配列 かつ customEditor !== true のエントリは、
    // 設定画面のどの入力欄一覧にも出てこない「見えない項目」になってしまう。
    // 今回のリファクタで実際に 4 件この状態が発生していたため、再発防止として機械的に検証する。
    const invisible = CONFIG_SCHEMA.filter(
        entry => entry.editable === 'gui' && (entry.fields ?? []).length === 0 && entry.customEditor !== true,
    ).map(entry => entry.key);
    assert.deepEqual(
        invisible,
        [],
        `fields も customEditor も無く画面に現れない gui エントリ: ${invisible.join(', ')}`,
    );
});

test('CONFIG_SCHEMA の key に重複が無い', () => {
    const seen = new Set();
    const duplicates = [];
    for (const key of schemaKeys) {
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
    }
    assert.deepEqual(duplicates, [], `CONFIG_SCHEMA 内で重複しているキー: ${duplicates.join(', ')}`);
});
