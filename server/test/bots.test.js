import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_BOT_LIMIT, botJoinDelays, botSeatTarget, isBotAuto, randomBotName } from '../src/bots.js';

test('auto mode varies the baseline over a wider range without exceeding 50', () => {
  assert.equal(isBotAuto({}), true);
  assert.equal(botSeatTarget({ botCount: '8' }, () => 0), 4);
  assert.equal(botSeatTarget({ botCount: '8' }, () => 0.999), 22);
  assert.equal(botSeatTarget({ botCount: '50' }, () => 0), 43);
  assert.equal(botSeatTarget({ botCount: '50' }, () => 0.999), AUTO_BOT_LIMIT);
  assert.equal(botSeatTarget({ botCount: '0' }), 0);
  assert.equal(botSeatTarget({ botCount: '99' }, () => 0.999), AUTO_BOT_LIMIT);
});

test('manual mode uses the exact count with no 50-bot cap', () => {
  assert.equal(isBotAuto({ botAuto: '0' }), false);
  assert.equal(botSeatTarget({ botAuto: '0', botCount: '0' }), 0);
  assert.equal(botSeatTarget({ botAuto: '0', botCount: '51' }), 51);
  assert.equal(botSeatTarget({ botAuto: '0', botCount: '137' }), 137);
  assert.equal(botSeatTarget({ botAuto: '0', botCount: '1000' }), 1000);
});

test('invalid stored bot counts do not produce unsafe loops', () => {
  assert.equal(botSeatTarget({ botAuto: '0', botCount: 'not-a-number' }), 0);
  assert.equal(botSeatTarget({ botCount: 'not-a-number' }), 0);
});

test('bots buy cards across the waiting window instead of all at once', () => {
  const delays = botJoinDelays(8, 30_000, () => 0.5);
  assert.equal(delays.length, 8);
  assert.ok(delays.every((delay) => delay > 0 && delay < 30_000));
  assert.ok(delays[7] - delays[0] > 15_000);
  assert.ok(new Set(delays).size > 1);
});

test('bot join timing stays inside short and long buying windows', () => {
  const short = botJoinDelays(5, 5_000, () => 0);
  const long = botJoinDelays(50, 30_000, () => 0.999);
  assert.ok(short.every((delay) => delay >= 0 && delay < 5_000));
  assert.ok(short[4] > short[0]);
  assert.ok(long.every((delay) => delay >= 0 && delay < 30_000));
  assert.ok(long[49] > long[0]);
  assert.deepEqual(botJoinDelays(0, 30_000), []);
  assert.deepEqual(botJoinDelays(3, 0), []);
});

test('bot names are unique male first names with no family names or numbers', () => {
  const used = new Set();
  for (let index = 0; index < 50; index += 1) {
    const name = randomBotName(used, () => 0.5);
    assert.match(name, /^[A-Z][a-z]+$/);
    assert.doesNotMatch(name, /Player|\d|Lucky/i);
  }
  assert.equal(used.size, 50);
});

test('some bot first names carry a chat emoji', () => {
  const name = randomBotName(new Set(), () => 0.9);
  assert.match(name, /^[A-Z][a-z]+ [^A-Za-z0-9\s]+$/u);
});
