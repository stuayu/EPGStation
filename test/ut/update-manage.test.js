'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../../dist/model/update/UpdateManageModel').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, debug: () => {} },
    }),
};

const release = (tag, prerelease, publishedAt = '2026-07-27T12:00:00Z') => ({
    tag_name: tag,
    name: tag,
    prerelease,
    draft: false,
    published_at: publishedAt,
    html_url: `https://github.com/stuayu/EPGStation/releases/tag/${tag}`,
    body: 'release note',
});

/**
 * 現在バージョンと導入形態は実環境 (git の状態) に依存するため、テストでは固定する
 */
function fixture(releases, options = {}) {
    const requests = [];
    const http = {
        get: async (url, option) => {
            requests.push({ url, option });
            if (options.httpError === true) throw new Error('network error');
            // リリース一覧とブランチ先頭コミットを 1 つのスタブで返し分ける
            const isCommit = url.includes('/commits/');
            if (isCommit === true && typeof options.commit === 'undefined') throw new Error('not found');
            return {
                status: options.status ?? 200,
                headers: new Map(),
                text: '',
                json: () =>
                    isCommit === true
                        ? {
                              sha: options.commit.sha,
                              html_url: `https://github.com/stuayu/EPGStation/commit/${options.commit.sha}`,
                              commit: {
                                  message: options.commit.message,
                                  committer: { date: options.commit.date },
                              },
                          }
                        : releases,
            };
        },
        post: async () => {
            throw new Error('not used');
        },
    };
    const config = { getConfig: () => ({ updateChecker: options.updateChecker ?? {} }) };
    const model = new Model(logger, config, http);
    model.currentVersion = options.currentVersion ?? '2.13.1-stuayu-260726';
    model.installationType = options.installationType ?? 'git';
    return { model, requests };
}

test('check picks the newest stable and prerelease separately', async () => {
    const { model } = fixture([
        release('2.13.1-stuayu-260726', false),
        release('2.14.0-stuayu-260727', false),
        release('2.15.0-beta-260801', true),
    ]);
    const status = await model.check();
    assert.equal(status.latestStable.tag, '2.14.0-stuayu-260727');
    assert.equal(status.latestPrerelease.tag, '2.15.0-beta-260801');
    assert.equal(status.checkError, null);
    assert.ok(status.checkedAt !== null);
});

test('the newest applicable release wins and its channel is reported', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false), release('2.15.0-beta-260801', true)]);
    const status = await model.check();
    // 既定ではプレリリースも通知対象に含める (UI 側で色を変えて区別する)
    assert.equal(status.availableRelease.tag, '2.15.0-beta-260801');
    assert.equal(status.availableChannel, 'prerelease');
});

test('prereleases are ignored when includePrerelease is false', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false), release('2.15.0-beta-260801', true)], {
        updateChecker: { includePrerelease: false },
    });
    const status = await model.check();
    assert.equal(status.availableRelease.tag, '2.14.0-stuayu-260727');
    assert.equal(status.availableChannel, 'stable');
    // 参照用にプレリリース情報自体は返す
    assert.equal(status.latestPrerelease.tag, '2.15.0-beta-260801');
});

test('no update is reported when the current version is the latest', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false)], {
        currentVersion: '2.14.0-stuayu-260727',
    });
    const status = await model.check();
    assert.equal(status.availableRelease, null);
    assert.equal(status.availableChannel, null);
});

test('draft releases are never offered', async () => {
    const draft = { ...release('2.99.0-stuayu-261231', false), draft: true };
    const { model } = fixture([release('2.14.0-stuayu-260727', false), draft]);
    const status = await model.check();
    assert.equal(status.latestStable.tag, '2.14.0-stuayu-260727');
});

test('a failed check keeps the previous cache and surfaces the reason', async () => {
    const { model } = fixture([], { httpError: true });
    // 前回の取得結果が残っている状態で失敗させる
    model.latestStable = { tag: '2.14.0-stuayu-260727', prerelease: false };
    const status = await model.check();
    assert.ok(status.checkError !== null);
    // 取得に失敗しても前回のキャッシュは捨てず、更新の案内も出し続ける
    assert.equal(status.latestStable.tag, '2.14.0-stuayu-260727');
    assert.equal(status.availableRelease.tag, '2.14.0-stuayu-260727');
});

test('update is not offered for archive installations', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false)], { installationType: 'archive' });
    const status = await model.check();
    assert.equal(status.canUpdate, false);
    await assert.rejects(() => model.run({}), /UpdateIsNotSupported/);
});

test('run rejects a tag that could be smuggled into git checkout', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false)]);
    await model.check();
    for (const tag of ['--upload-pack=evil', '../../etc/passwd', 'tag; rm -rf /', 'a'.repeat(101)]) {
        await assert.rejects(() => model.run({ tag }), /InvalidUpdateTag/);
    }
    assert.equal(model.getJob().status, 'idle');
});

test('run rejects when there is nothing to update to', async () => {
    const { model } = fixture([release('2.13.1-stuayu-260726', false)]);
    await model.check();
    await assert.rejects(() => model.run({}), /UpdateTargetIsNotFound/);
});

test('run refuses to start while another update is in progress', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false)]);
    await model.check();
    model.job = { ...model.getJob(), status: 'running' };
    await assert.rejects(() => model.run({}), /UpdateIsAlreadyRunning/);
});

test('the tracked branch head is reported and compared with the local HEAD', async () => {
    const { model } = fixture([release('2.14.0-stuayu-260727', false)], {
        commit: { sha: 'a'.repeat(40), message: 'Fix: 何かを直した\n\n詳細', date: '2026-07-28T01:00:00Z' },
    });
    model.currentCommit = 'b'.repeat(40);
    const status = await model.check();
    assert.equal(status.branch.name, 'main');
    assert.equal(status.branch.shortSha, 'aaaaaaa');
    // コミットメッセージは 1 行目だけを見せる
    assert.equal(status.branch.message, 'Fix: 何かを直した');
    assert.equal(status.branch.upToDate, false);
    assert.equal(status.currentCommit, 'b'.repeat(40));
});

test('the branch is up to date when the local HEAD matches', async () => {
    const sha = 'c'.repeat(40);
    const { model } = fixture([], { commit: { sha, message: 'chore', date: '2026-07-28T01:00:00Z' } });
    model.currentCommit = sha;
    const status = await model.check();
    assert.equal(status.branch.upToDate, true);
});

test('a configured branch is used and validated', async () => {
    const { model, requests } = fixture([], {
        commit: { sha: 'd'.repeat(40), message: 'x', date: null },
        updateChecker: { branch: 'develop' },
    });
    await model.check();
    assert.ok(requests.some(x => x.url.endsWith('/commits/develop')));

    // 危険な値は既定のブランチへフォールバックする
    const bad = fixture([], {
        commit: { sha: 'e'.repeat(40), message: 'x', date: null },
        updateChecker: { branch: '--upload-pack=evil' },
    });
    await bad.model.check();
    assert.ok(bad.requests.some(x => x.url.endsWith('/commits/main')));
});

test('run rejects branch names that could be smuggled into git checkout', async () => {
    const { model } = fixture([], { commit: { sha: 'f'.repeat(40), message: 'x', date: null } });
    await model.check();
    for (const ref of ['--upload-pack=evil', '-b', 'main;rm -rf /', 'a'.repeat(101)]) {
        await assert.rejects(() => model.run({ refType: 'branch', ref }), /InvalidUpdateTag/);
    }
    assert.equal(model.getJob().status, 'idle');
});

test('branch update is refused on archive installations', async () => {
    const { model } = fixture([], {
        installationType: 'archive',
        commit: { sha: '0'.repeat(40), message: 'x', date: null },
    });
    await model.check();
    await assert.rejects(() => model.run({ refType: 'branch' }), /UpdateIsNotSupported/);
});

test('only owner/repo is accepted as the repository to watch', async () => {
    const { model, requests } = fixture([], { updateChecker: { repository: 'https://evil.example.com/x' } });
    await model.check();
    assert.ok(requests[0].url.startsWith('https://api.github.com/repos/stuayu/EPGStation/releases'));

    const custom = fixture([], { updateChecker: { repository: 'l3tnun/EPGStation' } });
    await custom.model.check();
    assert.ok(custom.requests[0].url.startsWith('https://api.github.com/repos/l3tnun/EPGStation/releases'));
});

test('restartApplication is refused while an update job is running', async () => {
    const { model } = fixture([]);
    model.job = { ...model.getJob(), status: 'running' };
    assert.throws(() => model.restartApplication(), /UpdateIsAlreadyRunning/);
});
