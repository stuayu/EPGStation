'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { assertNotificationUrlIsAllowed } = require('../../dist/model/notification/NotificationUrlGuard');

test('rejects non http/https schemes', async () => {
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('file:///etc/passwd', false),
        /NotificationUrlSchemeNotAllowed/,
    );
});

test('rejects an invalid URL', async () => {
    await assert.rejects(() => assertNotificationUrlIsAllowed('not a url', false), /NotificationUrlIsInvalid/);
});

test('blocks loopback / private IPv4 targets by default (blind SSRF guard)', async () => {
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://127.0.0.1/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://localhost/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://10.0.0.5/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://192.168.1.1/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
});

test('blocks the cloud metadata address (169.254.169.254)', async () => {
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://169.254.169.254/latest/meta-data', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
});

test('allows a public IPv4 address', async () => {
    await assert.doesNotReject(() => assertNotificationUrlIsAllowed('http://93.184.216.34/hook', false));
});

test('allowPrivateNetworkTargets:true bypasses the private network guard', async () => {
    await assert.doesNotReject(() => assertNotificationUrlIsAllowed('http://127.0.0.1/hook', true));
    await assert.doesNotReject(() => assertNotificationUrlIsAllowed('http://192.168.1.1/hook', true));
});

test('blocks private IPv6 addresses (loopback / unique local)', async () => {
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://[::1]/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
    await assert.rejects(
        () => assertNotificationUrlIsAllowed('http://[fd00::1]/hook', false),
        /NotificationUrlTargetsPrivateNetwork/,
    );
});
