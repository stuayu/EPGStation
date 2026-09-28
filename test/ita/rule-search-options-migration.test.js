'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { DataSource } = require('typeorm');
const ProgramDB = require('../../dist/model/db/ProgramDB').default;
const {
    ImproveRuleSearchOptions1790572300000,
} = require('../../dist/db/migrations/sqlite/1790572300000-ImproveRuleSearchOptions');
const mysql = require('../../dist/db/migrations/mysql/1790572300000-ImproveRuleSearchOptions');

test('SQLite / MySQL migration は同じタイムスタンプを使う', () => {
    assert.equal(ImproveRuleSearchOptions1790572300000.name, 'ImproveRuleSearchOptions1790572300000');
    assert.equal(mysql.ImproveRuleSearchOptions1790572300000.name, 'ImproveRuleSearchOptions1790572300000');
});

test('既存ルールは除外語 all を保ち、新機能の既定値を false にする', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE rule (id INTEGER PRIMARY KEY)');
    db.exec('INSERT INTO rule (id) VALUES (1)');
    const migration = new ImproveRuleSearchOptions1790572300000();
    const runner = { query: async sql => db.exec(sql) };

    await migration.up(runner);
    assert.deepEqual(db.prepare('SELECT * FROM rule WHERE id = 1').get(), {
        id: 1,
        ignoreKeywordMatch: 'all',
        isFuzzy: 0,
        isGenreExclusion: 0,
        isChannelExclusion: 0,
        isTimeExclusion: 0,
    });
    db.prepare('UPDATE rule SET ignoreKeywordMatch = ?, isFuzzy = 1 WHERE id = 1').run('any');
    assert.equal(db.prepare('SELECT ignoreKeywordMatch FROM rule WHERE id = 1').get().ignoreKeywordMatch, 'any');
    await migration.down(runner);
    assert.deepEqual(db.prepare('SELECT * FROM rule').get(), { id: 1 });
    db.close();
});

test('SQLite のルール検索で既存 all は従来結果を維持し、any はいずれかの語で除外する', async () => {
    const source = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await source.initialize();
    try {
        await source.query(
            'CREATE TABLE program (id INTEGER PRIMARY KEY, halfWidthName TEXT, halfWidthDescription TEXT, halfWidthExtended TEXT)',
        );
        await source.query(
            `INSERT INTO program VALUES
                (1, 'cat dog', '', ''),
                (2, 'cat only', '', ''),
                (3, 'bird only', '', '')`,
        );

        const op = {
            isEnableCS: () => false,
            isEnabledRegexp: () => true,
            getLikeStr: () => 'like',
        };
        const programDB = new ProgramDB({ getLogger: () => ({}) }, { getConfig: () => ({}) }, op, {
            run: callback => callback(),
        });
        const findIds = async ignoreKeywordMatch => {
            const query = { strs: [], param: {} };
            programDB.setKeywordQuery({ ignoreKeyword: 'cat dog', ignoreKeywordMatch, ignoreName: true }, query);
            return source
                .createQueryBuilder()
                .select('program.id', 'id')
                .from('program', 'program')
                .where(query.strs.join(' and '), query.param)
                .orderBy('program.id', 'ASC')
                .getRawMany();
        };

        assert.deepEqual(await findIds('all'), [{ id: 2 }, { id: 3 }]);
        assert.deepEqual(await findIds('any'), [{ id: 3 }]);
    } finally {
        await source.destroy();
    }
});

test('NULL の副ジャンルがある番組をジャンル除外検索で残す', async () => {
    const source = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await source.initialize();
    try {
        await source.query(
            'CREATE TABLE program (id INTEGER PRIMARY KEY, genre1 INTEGER, genre2 INTEGER, genre3 INTEGER)',
        );
        await source.query('INSERT INTO program VALUES (1, 7, NULL, NULL), (2, 4, NULL, NULL)');
        const op = { isEnableCS: () => false, getLikeStr: () => 'like' };
        const programDB = new ProgramDB({ getLogger: () => ({}) }, { getConfig: () => ({}) }, op, { run: cb => cb() });
        const query = { strs: [], param: {} };
        programDB.setGenresQuery({ genres: [{ genre: 4 }], isGenreExclusion: true }, query);
        const rows = await source
            .createQueryBuilder()
            .select('program.id', 'id')
            .from('program', 'program')
            .where(query.strs.join(' and '), query.param)
            .getRawMany();
        assert.deepEqual(rows, [{ id: 1 }]);
    } finally {
        await source.destroy();
    }
});

test('分単位の曜日・時刻範囲は SQLite SQL で先に絞る', async () => {
    const source = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await source.initialize();
    try {
        await source.query('CREATE TABLE program (id INTEGER PRIMARY KEY, startAt INTEGER)');
        const utc = (day, hour, minute) => Date.UTC(2026, 8, 28 + day, hour - 9, minute);
        await source.query('INSERT INTO program VALUES (1, ?), (2, ?), (3, ?)', [
            utc(0, 23, 29),
            utc(0, 23, 30),
            utc(1, 1, 29),
        ]);
        const op = { isEnableCS: () => false, getLikeStr: () => 'like' };
        const programDB = new ProgramDB({ getLogger: () => ({}) }, { getConfig: () => ({}) }, op, { run: cb => cb() });
        const query = { strs: [], param: {} };
        programDB.setMinuteTimesQuery(
            { times: [{ week: 0x02, start: 23, startMinute: 30, range: 2 }] },
            query,
            'better-sqlite3',
        );
        const rows = await source
            .createQueryBuilder()
            .select('program.id', 'id')
            .from('program', 'program')
            .where(query.strs.join(' and '), query.param)
            .orderBy('program.id')
            .getRawMany();
        assert.deepEqual(rows, [{ id: 2 }, { id: 3 }]);
    } finally {
        await source.destroy();
    }
});
