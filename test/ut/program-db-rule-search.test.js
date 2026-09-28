'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ProgramDB = require('../../dist/model/db/ProgramDB').default;

function createDb() {
    const op = {
        isEnableCS: () => true,
        isEnabledRegexp: () => true,
        getLikeStr: () => 'like',
    };
    const db = new ProgramDB(
        { getLogger: () => ({}) },
        { getConfig: () => ({}) },
        op,
        { run: callback => callback() },
    );
    return db;
}

test('除外キーワードanyは語ごとにORし、allは従来の語ごとANDを維持する', () => {
    const db = createDb();
    const option = { name: true, description: true, extended: false, cs: false, regexp: false };
    const anyQuery = { strs: [], param: {} };
    db.setKeywordOption('猫 犬', option, 'ignoreKeyword', true, anyQuery, true);
    assert.equal(anyQuery.strs[0].startsWith('not ('), true);
    assert.match(anyQuery.strs[0], /ignoreKeywordAny0/);
    assert.match(anyQuery.strs[0], /ignoreKeywordAny1/);
    assert.match(anyQuery.strs[0], /or/);

    const allQuery = { strs: [], param: {} };
    db.setKeywordOption('猫 犬', option, 'ignoreKeyword', true, allQuery, false);
    assert.match(allQuery.strs[0], /ignoreKeywordName0.*ignoreKeywordName1/);
    assert.match(allQuery.strs[0], / and /);
});

test('時間帯の分指定は開始と終了を含む半開区間で評価する', () => {
    const db = createDb();
    const option = { times: [{ week: 0x02, start: 23, startMinute: 30, range: 2, rangeMinute: 0 }] };
    const at = (day, hour, minute) => {
        // 2026-09-28 is Monday; construct UTC then convert to Japan local clock.
        const date = new Date(Date.UTC(2026, 8, 28 + day, hour - 9, minute));
        return { startAt: date.getTime() };
    };
    assert.equal(db.matchesTimes(at(0, 23, 29), option), false);
    assert.equal(db.matchesTimes(at(0, 23, 30), option), true);
    assert.equal(db.matchesTimes(at(1, 1, 29), option), true);
    assert.equal(db.matchesTimes(at(1, 1, 30), option), false);
    assert.equal(db.matchesTimes(at(0, 1, 0), option), false);
});

test('あいまい検索はかな・半角カナ・空白と記号の差を吸収する', () => {
    const db = createDb();
    const program = { name: 'ｶﾞｼﾞｪｯﾄ　A-B', description: '', extended: '' };
    assert.equal(
        db.matchFuzzyKeywords(program, { isFuzzy: true, keyword: 'がじぇっと ab', name: true }),
        true,
    );
    assert.equal(
        db.matchFuzzyKeywords(program, { isFuzzy: true, keyword: '存在しない', name: true }),
        false,
    );
    assert.equal(
        db.matchFuzzyKeywords({ name: 'ABC', description: '', extended: '' }, {
            isFuzzy: true,
            keyword: 'abc',
            keyCS: true,
            name: true,
        }),
        false,
    );
});

test('日跨ぎ時刻は選択曜日の翌日を評価する', () => {
    const db = createDb();
    const option = { times: [{ week: 0x02, start: 23, range: 3 }] };
    const mondayOneAm = { startAt: Date.UTC(2026, 8, 27, 16) };
    const tuesdayOneAm = { startAt: Date.UTC(2026, 8, 28, 16) };
    assert.equal(db.matchesTimes(mondayOneAm, option), false);
    assert.equal(db.matchesTimes(tuesdayOneAm, option), true);
});

test('ジャンル・放送局・時間帯の除外指定は一致条件全体を反転する', () => {
    const db = createDb();
    const genreQuery = { strs: [], param: {} };
    db.setGenresQuery({ genres: [{ genre: 4 }], isGenreExclusion: true }, genreQuery);
    assert.match(genreQuery.strs[0], /^not \(/);

    const channelQuery = { strs: [], param: {} };
    db.setChannelQuery({ channelIds: [12], isChannelExclusion: true }, channelQuery);
    assert.equal(channelQuery.strs[0], 'not (channelId in (:...channelId))');

    const timeQuery = { strs: [], param: {} };
    db.setTimesQuery({ times: [{ week: 2, start: 10, range: 2 }], isTimeExclusion: true }, timeQuery);
    assert.match(timeQuery.strs[0], /^not \(/);
});
