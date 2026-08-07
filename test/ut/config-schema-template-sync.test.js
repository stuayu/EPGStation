'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_SCHEMA } = require('../../dist/model/config/ConfigSchema');

// ConfigSchema (単一の定義元) と config.yml.template / config-win.yml.template の記載が
// ずれていないかを機械的に確認する。
//
// テンプレートは全体が YAML コメント (`#`) として書かれているため YAML パーサには通せない。
// そこで各行を「先頭のコメント記号を剥がす → 残ったインデント幅で入れ子構造を復元する」
// 方式でテンプレートそのものをパースし、`a.b.c` 形式の完全パス集合を作る。
//
// テンプレートの行は大きく 2 パターンがある:
//   1. テンプレート全体を一括でコメントアウトする際に付与された外側の 1 段
//      (行頭 "# " のみ、それ以降は元の行がそのままのインデントで続く)
//   2. さらにその内側で「既定で無効化された省略可能な項目」を示す通常の YAML コメント
//      (インデント + "# " + キー、例: `#     # apiKey: ''`)
// どちらも "# " のパターンだが、内側 (2) は複数回ネストしうるため繰り返し剥がす。
// これにより leaf 名だけでなく完全パスで突合できるため、「別セクションの同名キーに
// 偶然マッチして誤って合格する」問題 (例: seriesLlm.url が notifications.url に
// マッチする) を防げる。
//
// leaf 名だけを見ていた旧実装は逆方向 (テンプレートにあるが ConfigSchema に無いキー) も
// 検証していなかったため、それも追加する。

const templatePaths = {
    unix: path.join(__dirname, '../../config/config.yml.template'),
    win: path.join(__dirname, '../../config/config-win.yml.template'),
};

const templateContents = Object.fromEntries(
    Object.entries(templatePaths).map(([os, p]) => [os, fs.readFileSync(p, 'utf8')]),
);

/**
 * テンプレートのテキストから、記載されているキーの完全パス ('a.b.c' 形式) 集合を作る。
 * @param {string} templateText
 * @return {Set<string>}
 */
function parseTemplatePaths(templateText) {
    const lines = templateText.split(/\r?\n/);
    // 現在のネスト経路。要素は { indent: そのキーのインデント幅, fullPath: 完全パス }
    const stack = [];
    const paths = new Set();

    for (const raw of lines) {
        let line = raw;

        // 外側の 1 段 (テンプレート全体をコメントアウトした際に付与された "# ") を剥がす。
        // これは常に行頭 (列 0) に 1 回だけ現れる
        if (line.startsWith('#')) {
            line = line.slice(1);
            if (line.startsWith(' ')) {
                line = line.slice(1);
            }
        }

        // 内側のコメント記号 (インデント + "#" + 空白 1 個) を繰り返し剥がす。
        // 剥がすたびに、そのときのインデント幅を確定させる (最後に成功した幅が採用される)
        let indent = null;
        let strippedInner = false;
        for (;;) {
            const m = /^( *)#\s?/.exec(line);
            if (m === null) {
                break;
            }
            indent = m[1].length;
            line = line.slice(m[0].length);
            strippedInner = true;
        }

        // 内側のコメント記号が 1 度も無かった場合は、残った行の先頭空白数がそのままインデント
        let content;
        if (strippedInner) {
            content = line;
        } else {
            const m = /^( *)/.exec(line);
            indent = m[1].length;
            content = line.slice(indent);
        }

        const keyMatch = /^([A-Za-z][A-Za-z0-9_]*)\s*:(\s|$)/.exec(content);
        if (keyMatch === null) {
            // キー行ではない (説明文のコメント行、配列要素の "- " 行など)
            continue;
        }
        const key = keyMatch[1];

        // 現在のインデント以上の要素はすべて兄弟以下なのでスタックから外す
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const fullPath = stack.length > 0 ? `${stack[stack.length - 1].fullPath}.${key}` : key;
        stack.push({ indent, fullPath });
        paths.add(fullPath);
    }

    return paths;
}

const templatePathSets = Object.fromEntries(
    Object.entries(templateContents).map(([os, text]) => [os, parseTemplatePaths(text)]),
);

const allTopLevelKeys = CONFIG_SCHEMA.map(entry => entry.key);
const allFieldPaths = CONFIG_SCHEMA.flatMap(entry => (entry.fields ?? []).map(field => field.path));

// テンプレートに登場するが ConfigSchema では管理していないトップレベルキー。
// スキーマ管理外と判断したキーだけをここに理由付きで列挙する。
// 現状は無し (テンプレートの全トップレベルキーが CONFIG_SCHEMA に対応している)
const TOP_LEVEL_KEYS_NOT_IN_SCHEMA = new Set([]);

for (const [os, pathSet] of Object.entries(templatePathSets)) {
    const templateLabel = os === 'win' ? 'config-win.yml.template' : 'config.yml.template';

    test(`every ConfigSchema top-level key is documented in ${templateLabel}`, () => {
        const missing = allTopLevelKeys.filter(key => !pathSet.has(key));
        assert.deepEqual(
            missing,
            [],
            `ConfigSchema にあるが ${templatePaths[os]} に記載がないキー: ${missing.join(', ')}`,
        );
    });

    test(`every ConfigSchema field path is documented in ${templateLabel}`, () => {
        const missing = allFieldPaths.filter(fieldPath => !pathSet.has(fieldPath));
        assert.deepEqual(
            missing,
            [],
            `ConfigSchema にあるが ${templatePaths[os]} に記載がないフィールド (完全パス一致): ${missing.join(', ')}`,
        );
    });

    test(`${templateLabel} has no top-level key missing from ConfigSchema`, () => {
        const templateTopLevelKeys = [...pathSet].filter(p => !p.includes('.'));
        const schemaKeySet = new Set(allTopLevelKeys);
        const undocumented = templateTopLevelKeys.filter(
            key => !schemaKeySet.has(key) && !TOP_LEVEL_KEYS_NOT_IN_SCHEMA.has(key),
        );
        assert.deepEqual(
            undocumented,
            [],
            `${templatePaths[os]} にあるが ConfigSchema に無いトップレベルキー (スキーマ管理外なら ` +
                `TOP_LEVEL_KEYS_NOT_IN_SCHEMA に理由付きで追加すること): ${undocumented.join(', ')}`,
        );
    });
}

test('CONFIG_SCHEMA is not empty (sanity check that dist import worked)', () => {
    assert.ok(CONFIG_SCHEMA.length > 50);
});
