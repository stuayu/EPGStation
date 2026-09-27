'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    decideAudioTrackSwitch,
    decideOfflineAudioTrackSwitch,
    needsAudioTrackReapplyAfterReconnect,
    resolveAppliedAudioTrack,
} = require('../../dist/util/AudioTrackSwitchDecision');

test('同じ音声トラックを選んだ場合は何もしない', () => {
    assert.equal(decideAudioTrackSwitch('sub', 'sub', false), 'noop');
    assert.equal(decideAudioTrackSwitch('main', 'main', true), 'noop');
});

test('同時配信可能な音声トラックは再接続せず切り替える', () => {
    assert.equal(decideAudioTrackSwitch('main', 'sub', true), 'embedded');
});

test('同時配信できない音声トラックは再接続する', () => {
    assert.equal(decideAudioTrackSwitch('main', 'sub', false), 'reconnect');
});

test('オフラインのデュアルモノラルは読み直さず、独立音声 ES は読み直す', () => {
    assert.equal(decideOfflineAudioTrackSwitch('main', 'sub', true), 'dual-mono');
    assert.equal(decideOfflineAudioTrackSwitch('main', 'sub', false), 'reload');
    assert.equal(decideOfflineAudioTrackSwitch('sub', 'sub', false), 'noop');
});

// Issue #31: 再接続 (ストリーム作り直し) 直後、新しいストリームは必ず主音声から始まる。
// 判定はクライアントが持つ embeddedAudioSwitch フラグ (playback-options 未取得だと false)
// ではなく、新しいストリームが実際に持つ音声レンディション数で行う。
// フラグが未取得のまま再接続しても、サーバーが tsreadex 正規化済みなら実際には
// 2 レンディションで開いていることがあるため、フラグ判定だと選び直しを取りこぼす
// (報告された「主音声に切り替えてからもう一度副音声を選ぶと効く」症状の原因)。
test('レンディション 2 本以上 + 副音声のときだけ選び直しが要る', () => {
    // 2 本以上 + 副音声 → 選び直しが要る (新ストリームは主音声レンディションから始まるため)
    assert.equal(needsAudioTrackReapplyAfterReconnect(2, true), true);
    assert.equal(needsAudioTrackReapplyAfterReconnect(3, true), true);
    // 1 本 + 副音声 → 要らない (サーバーが要求どおり副音声だけを単独レンディションで
    // 流しているため、選び直す先が無い)
    assert.equal(needsAudioTrackReapplyAfterReconnect(1, true), false);
    // 0 本 (取得できず/タイムアウト) + 副音声 → 要らない (選び直す対象が無い)
    assert.equal(needsAudioTrackReapplyAfterReconnect(0, true), false);
    // 選択中が主音声 → 何本でも要らない (新ストリームは常に主音声から始まる)
    assert.equal(needsAudioTrackReapplyAfterReconnect(2, false), false);
    assert.equal(needsAudioTrackReapplyAfterReconnect(1, false), false);
    assert.equal(needsAudioTrackReapplyAfterReconnect(0, false), false);
});

// 選び直しに失敗したら、実際に鳴っている主音声へ内部状態を合わせる。
// 要求値のまま保持すると、次に同じ副音声を選んでも decideAudioTrackSwitch が
// current === next で noop を返し、二度と切り替えられなくなる (実際に報告された症状)。
test('レンディションの選び直しに失敗したら main へ戻し、成功すれば要求値を保つ', () => {
    assert.equal(resolveAppliedAudioTrack('sub', true), 'sub');
    assert.equal(resolveAppliedAudioTrack('sub', false), 'main');
});
