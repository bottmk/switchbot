import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFanAction, validateFanConfig } from '../src/config.js';

const base = {
  enabled: true,
  fanDeviceId: 'FAN',
  sensorDeviceId: 'SENSOR',
  onC: 28,
  offC: 26,
  night: 'allday',
};

test('turns on at/above the ON threshold (daytime)', () => {
  assert.equal(decideFanAction(base, 28, 12), 'on');
  assert.equal(decideFanAction(base, 30, 12), 'on');
});

test('turns off at/below the OFF threshold (daytime)', () => {
  assert.equal(decideFanAction(base, 26, 12), 'off');
  assert.equal(decideFanAction(base, 24, 12), 'off');
});

test('hysteresis band returns null (no change)', () => {
  assert.equal(decideFanAction(base, 27, 12), null);
});

test('disabled config never acts', () => {
  assert.equal(decideFanAction({ ...base, enabled: false }, 30, 12), null);
});

test('missing sensor/fan id never acts', () => {
  assert.equal(decideFanAction({ ...base, fanDeviceId: '' }, 30, 12), null);
});

test('non-numeric temperature never acts', () => {
  assert.equal(decideFanAction(base, undefined, 12), null);
});

test('night mode "no-on" suppresses ON but allows OFF', () => {
  const cfg = { ...base, night: 'no-on' };
  assert.equal(decideFanAction(cfg, 30, 2), null); // 2am, hot → suppressed
  assert.equal(decideFanAction(cfg, 24, 2), 'off'); // 2am, cold → still off
  assert.equal(decideFanAction(cfg, 30, 12), 'on'); // noon → normal
});

test('night mode "off" disables all automation at night', () => {
  const cfg = { ...base, night: 'off' };
  assert.equal(decideFanAction(cfg, 30, 2), null);
  assert.equal(decideFanAction(cfg, 24, 2), null);
  assert.equal(decideFanAction(cfg, 30, 12), 'on');
});

test('night window boundaries (23:00 inclusive, 07:00 exclusive)', () => {
  const cfg = { ...base, night: 'off' };
  assert.equal(decideFanAction(cfg, 30, 23), null); // 23:00 is night
  assert.equal(decideFanAction(cfg, 30, 6), null); // 06:00 is night
  assert.equal(decideFanAction(cfg, 30, 7), 'on'); // 07:00 is day
  assert.equal(decideFanAction(cfg, 30, 22), 'on'); // 22:00 is day
});

test('validateFanConfig enforces hysteresis (off below on)', () => {
  const c = validateFanConfig({ onC: 25, offC: 27 });
  assert.ok(c.offC < c.onC);
});

test('validateFanConfig clamps and coerces types', () => {
  const c = validateFanConfig({ enabled: 'yes', onC: '28', offC: '26', night: 'bogus' });
  assert.equal(c.enabled, false); // non-boolean ignored → default false
  assert.equal(c.onC, 28);
  assert.equal(c.offC, 26);
  assert.equal(c.night, 'no-on'); // invalid → default
});
