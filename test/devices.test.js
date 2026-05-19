import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDevices, lookupRoom } from '../src/devices.js';

test('loadDevices parses a valid array', () => {
  const env = { DEVICES: '[{"deviceId":"AA:BB:CC:DD:EE:FF","room":"living"}]' };
  assert.deepEqual(loadDevices(env), [{ deviceId: 'AA:BB:CC:DD:EE:FF', room: 'living' }]);
});

test('loadDevices treats missing DEVICES as empty', () => {
  assert.deepEqual(loadDevices({}), []);
});

test('loadDevices rejects non-array', () => {
  assert.throws(() => loadDevices({ DEVICES: '{"deviceId":"x","room":"y"}' }));
});

test('loadDevices rejects entry missing keys', () => {
  assert.throws(() => loadDevices({ DEVICES: '[{"deviceId":"x"}]' }));
});

test('lookupRoom matches when DEVICES uses colons and webhook does not', () => {
  const devices = [{ deviceId: 'AA:BB:CC:DD:EE:FF', room: 'living' }];
  assert.equal(lookupRoom(devices, 'AABBCCDDEEFF'), 'living');
});

test('lookupRoom matches when DEVICES has no colons and webhook does', () => {
  const devices = [{ deviceId: 'AABBCCDDEEFF', room: 'bedroom' }];
  assert.equal(lookupRoom(devices, 'AA:BB:CC:DD:EE:FF'), 'bedroom');
});

test('lookupRoom is case-insensitive', () => {
  const devices = [{ deviceId: 'aabbccddeeff', room: 'kitchen' }];
  assert.equal(lookupRoom(devices, 'AABBCCDDEEFF'), 'kitchen');
});

test('lookupRoom returns undefined when no match', () => {
  const devices = [{ deviceId: 'AABBCCDDEEFF', room: 'living' }];
  assert.equal(lookupRoom(devices, '112233445566'), undefined);
});

test('lookupRoom handles empty deviceId', () => {
  assert.equal(lookupRoom([], ''), undefined);
  assert.equal(lookupRoom([], null), undefined);
});
