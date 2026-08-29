'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const revision = fs.readFileSync(path.join(root, '.github/mirakurun-revision'), 'utf8').trim();
const packageLock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');

test('the pinned revision matches the Mirakurun package lock entry', () => {
    assert.match(packageLock, new RegExp(`#${revision}`));
});

for (const workflowName of ['release.yml', 'build-validation.yml']) {
    test(`${workflowName} uses the pinned Mirakurun revision and reproducible install`, () => {
        const workflow = fs.readFileSync(path.join(root, '.github/workflows', workflowName), 'utf8');
        assert.match(workflow, /ref: \$\{\{ steps\.mirakurunRevision\.outputs\.revision \}\}/);
        assert.doesNotMatch(workflow, /ref:\s*stuayu-main/);
        assert.match(workflow, /npm ci/);
        assert.match(workflow, /create-build-manifest\.js/);
        assert.match(workflow, /Mirakurun revision/);
        assert.ok(revision.length === 40 && /^[0-9a-f]+$/.test(revision));
    });
}
