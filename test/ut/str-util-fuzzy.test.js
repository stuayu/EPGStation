'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const StrUtil = require('../../dist/util/StrUtil').default;

test('あいまい検索正規化はかな・半角カナ・英数・空白と記号の差を吸収する', () => {
    const cases = [
        ['ひらがな', 'ヒラガナ'],
        ['ｶﾀｶﾅ', 'カタカナ'],
        ['ＡＢＣ１２３', 'abc123'],
        ['東京　タワー', '東京タワー'],
        ['A-B_C！', 'abc'],
    ];
    for (const [input, expected] of cases) {
        assert.equal(StrUtil.normalizeFuzzy(input), StrUtil.normalizeFuzzy(expected));
    }
    assert.notEqual(StrUtil.normalizeFuzzy('ABC', true), StrUtil.normalizeFuzzy('abc', true));
});
