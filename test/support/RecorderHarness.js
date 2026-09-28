'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('reflect-metadata');
const Mirakurun = require('mirakurun').default;
const RecorderModel = require('../../dist/model/operator/recording/RecorderModel').default;
const RecordingStreamCreator = require('../../dist/model/operator/recording/RecordingStreamCreator').default;

const logger = { system: { info() {}, debug() {}, warn() {}, error() {}, fatal() {} }, stream: { fatal() {} } };

class RecorderHarness {
    constructor(stub, options = {}) {
        this.stub = stub;
        this.events = { start: [], finish: [], failed: [] };
        this.recorded = [];
        this.videoFiles = [];
        this.recordingSessions = [];
        this.recordingAttempts = [];
        this.tempDir = null;
        this.client = new Mirakurun();
        this.configuration = {
            getConfig: () => ({
                mirakurunPath: 'http://127.0.0.1:1',
                recPriority: 10,
                conflictPriority: 1,
                recorded: [],
                recording: {
                    prepRecSec: 0,
                    startMarginSec: 0,
                    endMarginSec: 0,
                    startGateEnabled: false,
                    programStreamMode: 'service',
                    shareUpstreamStream: true,
                    ...options.recording,
                },
                isEnabledDropCheck: options.isEnabledDropCheck === true,
                timeSpecifiedStartMargin: 0,
                timeSpecifiedEndMargin: 0,
            }),
        };
        this.client.host = '127.0.0.1';
        this.client.port = 0;
        this.client.basePath = '/api';
        this.mirakurunClient = { getClient: () => this.client };
        this.recordingStreamCreator = new RecordingStreamCreator(
            { getLogger: () => logger },
            this.configuration,
            this.mirakurunClient,
        );
        const originalSetInterval = global.setInterval;
        global.setInterval = (...args) => {
            const timer = originalSetInterval(...args);
            timer.unref();
            return timer;
        };
        try {
            this.recordingStreamCreator.setTuner([{ name: 'test', types: ['GR'] }]);
        } finally {
            global.setInterval = originalSetInterval;
        }
    }

    async start() {
        const url = new URL(await this.stub.start());
        this.client.host = url.hostname;
        this.client.port = Number(url.port);
        this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-recorder-harness-'));
        let fileNo = 0;
        this.recordedDB = {
            insertOnce: async row => {
                row.id = this.recorded.length + 1;
                this.recorded.push(row);
                return row.id;
            },
            findId: async id => this.recorded.find(row => row.id === id) ?? null,
            removeRecording: async id => {
                const row = this.recorded.find(item => item.id === id);
                if (row) row.isRecording = false;
            },
            updateOnce: async row => {
                if (
                    row.videoFiles !== undefined ||
                    row.thumbnails !== undefined ||
                    row.tags !== undefined ||
                    row.dropLogFile !== undefined
                ) {
                    throw new Error('EntityPropertyNotFoundError: relation properties cannot be updated');
                }
                const index = this.recorded.findIndex(item => item.id === row.id);
                if (index >= 0) this.recorded[index] = row;
            },
            updateRecordingResult: async (id, values) => {
                const row = this.recorded.find(item => item.id === id);
                if (row) Object.assign(row, values);
            },
            deleteRecordedWithRelatedData: async id => {
                this.recorded = this.recorded.filter(row => row.id !== id);
            },
        };
        this.recordingSessionDB = {
            createSession: async row => {
                const value = { ...row, id: this.recordingSessions.length + 1 };
                this.recordingSessions.push(value);
                return value;
            },
            updateSession: async (id, values) => {
                Object.assign(
                    this.recordingSessions.find(row => row.id === id),
                    values,
                );
            },
            createAttempt: async row => {
                const value = { ...row, id: this.recordingAttempts.length + 1 };
                this.recordingAttempts.push(value);
                return value;
            },
            updateAttempt: async (id, values) => {
                Object.assign(
                    this.recordingAttempts.find(row => row.id === id),
                    values,
                );
            },
            findByState: async state => this.recordingSessions.filter(row => row.state === state),
            findByRecordedId: async id => this.recordingSessions.filter(row => row.recordedId === id),
            findAttemptsBySessionId: async id => this.recordingAttempts.filter(row => row.sessionId === id),
            deleteOrphanSessionsBefore: async () => 0,
        };
        this.videoFileDB = {
            insertOnce: async row => {
                row.id = this.videoFiles.length + 1;
                this.videoFiles.push(row);
                return row.id;
            },
        };
        this.recordingUtil = {
            getRecPath: async () => {
                fileNo++;
                const fileName = `baseline${fileNo === 1 ? '' : ` (${fileNo - 1})`}.ts`;
                return {
                    fullPath: path.join(this.tempDir, fileName),
                    parendDir: { name: this.tempDir },
                    subDir: '',
                    fileName,
                };
            },
            updateVideoFileSize: async () => {},
        };
        this.recordingEvent = {
            emitStartPrepRecording: (...args) => this.events.prep?.push(args),
            emitStartRecording: (...args) => this.events.start.push(args),
            emitFinishRecording: (...args) => this.events.finish.push(args),
            emitRecordingFailed: (...args) => this.events.failed.push(args),
            emitCancelRecording: () => {},
            emitCancelPrepRecording: () => {},
        };
        this.recorder = this.createRecorder();
    }

    createRecorder() {
        return new RecorderModel(
            { getLogger: () => logger },
            this.configuration,
            { findId: async id => ({ id }), findChannelIdAndTime: async () => null, findSchedule: async () => [] },
            { findId: async id => ({ id }) },
            { findId: async id => ({ id }), updateFollowingSchedule: async () => {} },
            this.recordedDB,
            {},
            this.videoFileDB,
            {},
            this.recordingStreamCreator,
            { start: async () => {}, stop: async () => {}, getResult: async () => ({}), getFilePath: () => null },
            this.recordingUtil,
            this.recordingEvent,
            this.mirakurunClient,
            { dispatch: async () => {} },
            { emitUpdated: () => {} },
            { update: () => {} },
            { notifyEitPresent: () => {} },
            this.recordingSessionDB,
        );
    }

    async cleanup() {
        this.recorder?.cancel(false);
        await this.stub.stop();
        if (this.tempDir) await fs.promises.rm(this.tempDir, { recursive: true, force: true });
    }
}

module.exports = { RecorderHarness };
