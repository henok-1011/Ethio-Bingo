import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_BOT_LIMIT, botSeatTarget, isBotAuto } from '../src/bots.js';

test('auto mode varies the baseline without exceeding 50', () => {
  assert.equal(isBotAuto({}), true);
  assert.equal(botSeatTarget({ botCount: '8' }, () => 0), 6);
  assert.equal(botSeatTarget({ botCount: '8' }, () => 0.999), 16);
  assert.equal(botSeatTarget({ botCount: '50' }, () => 0), 48);
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
