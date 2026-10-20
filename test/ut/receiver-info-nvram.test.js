const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeReceiverInfoValue, encodeReceiverInfoValue } = require('../../dist/util/ReceiverInfoNvram');

test('receiverinfo NVRAM uses web-bml base64 byte encoding', () => {
    assert.equal(encodeReceiverInfoValue('1234567', 7), Buffer.from('1234567').toString('base64'));
    assert.equal(
        decodeReceiverInfoValue(encodeReceiverInfoValue(String.fromCharCode(13), 1), 1, ''),
        String.fromCharCode(13),
    );
    assert.equal(decodeReceiverInfoValue(null, 2, '\0\0'), '\0\0');
    assert.throws(() => encodeReceiverInfoValue('123', 7), /7 byte/);
});
