import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_BOT_LIMIT, botSeatTarget, isBotAuto, randomBotName } from '../src/bots.js';

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

test('bot names are unique Ethiopian full names with no numbered fallback', () => {
  const used = new Set();
  for (let index = 0; index < 432; index += 1) {
    const name = randomBotName(used, () => 0.5);
    assert.match(name, /^[A-Z][a-z]+(?: [A-Z][a-z]+)+$/);
    assert.doesNotMatch(name, /Player|\d|Lucky/i);
  }
  assert.equal(used.size, 432);
});
