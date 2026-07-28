'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildAuthorizeUrl,
    createOAuthState,
    verifyOAuthState,
    extractProfile,
    isOAuthProviderId,
    OAUTH_PROVIDERS,
} = require('../../dist/model/auth/OAuthProviders');

test('only the supported providers are accepted (the id goes into a URL path)', () => {
    assert.equal(isOAuthProviderId('google'), true);
    assert.equal(isOAuthProviderId('github'), true);
    assert.equal(isOAuthProviderId('evil'), false);
    assert.equal(isOAuthProviderId('../../etc'), false);
    assert.equal(isOAuthProviderId(undefined), false);
});

test('the authorize url carries the client id, redirect uri, scope and state', () => {
    const url = new URL(
        buildAuthorizeUrl('google', 'client-123', 'https://epg.example.com/api/auth/oauth/google/callback', 'state-1'),
    );
    assert.equal(`${url.origin}${url.pathname}`, OAUTH_PROVIDERS.google.authorizeUrl);
    assert.equal(url.searchParams.get('client_id'), 'client-123');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://epg.example.com/api/auth/oauth/google/callback');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'state-1');
    assert.equal(url.searchParams.get('scope'), OAUTH_PROVIDERS.google.scope);
});

test('state round trips and is bound to the provider that issued it', () => {
    const state = createOAuthState('github', 'secret', 60000);
    assert.notEqual(verifyOAuthState(state, 'github', 'secret'), null);
    // 別プロバイダのコールバックへ持ち込んでも通らない
    assert.equal(verifyOAuthState(state, 'google', 'secret'), null);
});

test('state is rejected when forged, expired or signed by another key', () => {
    const state = createOAuthState('google', 'secret', 60000);
    assert.equal(verifyOAuthState(state, 'google', 'another-secret'), null);
    assert.equal(verifyOAuthState(`${state}x`, 'google', 'secret'), null);
    assert.equal(verifyOAuthState(undefined, 'google', 'secret'), null);
    assert.equal(verifyOAuthState('garbage', 'google', 'secret'), null);

    const expired = createOAuthState('google', 'secret', -1);
    assert.equal(verifyOAuthState(expired, 'google', 'secret'), null);
});

test('google profiles are read from the OpenID Connect fields', () => {
    assert.deepEqual(extractProfile('google', { sub: '123', email: 'a@example.com', name: 'Taro' }), {
        providerUserId: '123',
        email: 'a@example.com',
        name: 'Taro',
    });
    // 名前が無ければメール、それも無ければ id を表示名にする
    assert.equal(extractProfile('google', { sub: '123', email: 'a@example.com' }).name, 'a@example.com');
    assert.equal(extractProfile('google', { sub: '123' }).name, 'google-123');
    // sub が無い応答は識別できないので拒否する
    assert.equal(extractProfile('google', { email: 'a@example.com' }), null);
    assert.equal(extractProfile('google', null), null);
});

test('github profiles fall back to the primary address when the email is private', () => {
    assert.deepEqual(extractProfile('github', { id: 42, login: 'octocat', email: 'octo@example.com' }), {
        providerUserId: '42',
        email: 'octo@example.com',
        name: 'octocat',
    });
    const hidden = extractProfile('github', { id: 42, login: 'octocat' }, [
        { email: 'other@example.com', primary: false },
        { email: 'primary@example.com', primary: true },
    ]);
    assert.equal(hidden.email, 'primary@example.com');
    // メールが取れなくてもログインはできる (表示名は login)
    assert.equal(extractProfile('github', { id: 42, login: 'octocat' }).email, null);
    assert.equal(extractProfile('github', {}), null);
});
