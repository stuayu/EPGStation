'use strict';
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { buildNotificationRequest } = require('../../dist/model/notification/NotificationRequest');
const event = {
    id: 'delivery-1',
    type: 'recording.completed',
    occurredAt: 0,
    payload: { name: '番組', recordedId: 1 },
};
test('webhook request is stable and HMAC signed', () => {
    const r = buildNotificationRequest({ name: 'x', type: 'webhook', url: 'http://x', secret: 'secret' }, event);
    assert.deepEqual(JSON.parse(r.body), event);
    assert.equal(
        r.headers['x-epgstation-signature-256'],
        `sha256=${createHmac('sha256', 'secret').update(r.body).digest('hex')}`,
    );
});
test('discord request uses an embed', () => {
    const r = buildNotificationRequest({ name: 'd', type: 'discord', url: 'http://x' }, event);
    const body = JSON.parse(r.body);
    assert.equal(body.embeds[0].title, '録画が完了しました');
    assert.equal(body.embeds[0].description, '番組');
});
test('開始前失敗は警告色の専用通知になる', () => {
    const r = buildNotificationRequest(
        { name: 'd', type: 'discord', url: 'http://x' },
        { ...event, type: 'recording.startFailed' },
    );
    const embed = JSON.parse(r.body).embeds[0];
    assert.equal(embed.title, '録画開始前に失敗しました');
    assert.equal(embed.color, 15158332);
});

test('追加通知種別は Discord の既定失敗タイトルへ落ちない', () => {
    const titles = {
        'recording.startFailed': '録画開始前に失敗しました',
        'program.starting': '番組がまもなく始まります',
        'recording.partial': '録画が一部欠落して終了しました',
        'power.suspending': 'まもなく省電力状態へ移行します',
    };
    for (const [type, title] of Object.entries(titles)) {
        const embed = JSON.parse(
            buildNotificationRequest({ name: 'd', type: 'discord', url: 'http://x' }, { ...event, type }).body,
        ).embeds[0];
        assert.equal(embed.title, title);
        assert.notEqual(embed.title, '録画に失敗しました');
        if (type !== 'program.starting') assert.equal(embed.color, 15158332);
    }
});
