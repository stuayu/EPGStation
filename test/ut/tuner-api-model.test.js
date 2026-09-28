'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { toTunerItems } = require('../../dist/model/api/tuner/TunerApiModel');

test('Mirakurun のチューナー情報を公開 API の形へ変換する', () => {
    assert.deepEqual(toTunerItems([{ index: 2, name: '地上波', types: ['GR'], isUsing: true }]), [
        { index: 2, name: '地上波', types: ['GR'], isUsing: true },
    ]);
});
