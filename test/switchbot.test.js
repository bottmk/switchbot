import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcAbsoluteHumidity, jstTimestamp } from '../src/switchbot.js';

test('calcAbsoluteHumidity at 20C 50% is around 8.65 g/m^3', () => {
  const ah = calcAbsoluteHumidity(20, 50);
  assert.ok(Math.abs(ah - 8.65) < 0.1, `got ${ah}`);
});

test('calcAbsoluteHumidity at 30C 60% is around 18.2 g/m^3', () => {
  const ah = calcAbsoluteHumidity(30, 60);
  assert.ok(Math.abs(ah - 18.2) < 0.2, `got ${ah}`);
});

test('calcAbsoluteHumidity at 0C 100% is around 4.85 g/m^3', () => {
  const ah = calcAbsoluteHumidity(0, 100);
  assert.ok(Math.abs(ah - 4.85) < 0.1, `got ${ah}`);
});

test('calcAbsoluteHumidity is rounded to 2 decimal places', () => {
  const ah = calcAbsoluteHumidity(22.5, 55);
  // Just verify the result has at most 2 decimal places
  assert.equal(Math.round(ah * 100), ah * 100);
});

test('jstTimestamp format is YYYY-MM-DD HH:MM:SS', () => {
  const ts = jstTimestamp();
  assert.match(ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
