'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { DataSource } = require('typeorm');
const RecordedDB = require('../../dist/model/db/RecordedDB').default;

test('関連VideoFile付きfindIdの録画結果を専用更新で保存できる', async () => {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: true,
        logging: false,
        entities: [path.join(__dirname, '../../dist/db/entities/**/*.js')],
    });
    await dataSource.initialize();
    try {
        const recordedRepo = dataSource.getRepository('Recorded');
        const videoRepo = dataSource.getRepository('VideoFile');
        const row = await recordedRepo.save({
            reserveId: 1,
            ruleId: null,
            programId: null,
            channelId: 1,
            isProtected: false,
            startAt: 1000,
            endAt: 2000,
            duration: 1000,
            name: 'test',
            halfWidthName: 'test',
            isRecording: false,
            recordingStatus: null,
            endReason: null,
            dropLogFileId: null,
        });
        await videoRepo.save({
            parentDirectoryName: 'recorded',
            filePath: 'test.ts',
            type: 'ts',
            name: 'test.ts',
            size: 188,
            isExternalFile: false,
            duration: null,
            startTime: null,
            startAt: null,
            videoCodec: null,
            audioCodec: null,
            width: null,
            height: null,
            bitRate: null,
            analyzedAt: null,
            recordedId: row.id,
        });
        const logger = { getLogger: () => ({ system: { error() {} } }) };
        const op = { getConnection: async () => dataSource };
        const retry = { run: fn => fn() };
        const db = new RecordedDB(op, retry, {}, {}, logger);
        const found = await db.findId(row.id);
        assert.equal(found.videoFiles.length, 1);

        // 実装前にリレーション付きエンティティを set すると TypeORM が relation property で失敗する。
        await assert.rejects(
            () =>
                dataSource
                    .createQueryBuilder()
                    .update(require('../../dist/db/entities/Recorded').default)
                    .set({ ...found, recordingStatus: 'completed', endReason: 'scheduled-end' })
                    .where({ id: row.id })
                    .execute(),
            /videoFiles/,
        );
        await db.updateRecordingResult(row.id, { recordingStatus: 'completed', endReason: 'scheduled-end' });
        const updated = await db.findId(row.id);
        assert.equal(updated.recordingStatus, 'completed');
        assert.equal(updated.endReason, 'scheduled-end');
        assert.equal(updated.videoFiles.length, 1);
    } finally {
        await dataSource.destroy();
    }
});
