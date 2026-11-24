import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import {
  playBonusText,
  registrationBonusSantim,
  registrationBonusText,
  splitBonusRefund,
  splitBonusStake,
} from '../src/registration-bonus.js';

test('welcome bonus is enabled at 50 ETB by default', () => {
  assert.equal(DEFAULT_SETTINGS.registrationBonusEnabled, '1');
  assert.equal(DEFAULT_SETTINGS.registrationBonus, '5000');
  assert.equal(
    registrationBonusSantim({ registrationBonusEnabled: '1', registrationBonus: '5000' }),
    5000,
  );
});

test('welcome bonus can be disabled or set to zero', () => {
  assert.equal(
    registrationBonusSantim({ registrationBonusEnabled: '0', registrationBonus: '5000' }),
    0,
  );
  assert.equal(
    registrationBonusSantim({ registrationBonusEnabled: '1', registrationBonus: '0' }),
    0,
  );
});

test('promo message includes the player name and amount', () => {
  const text = registrationBonusText('Hanna', 5000);
  assert.match(text, /ሰላም Hanna!/);
  assert.match(text, /50 ብር/);
  assert.match(text, /Selam Hanna!/);
  assert.match(text, /50 birr play-only bonus/);
  assert.match(text, /cannot be withdrawn/);
  assert.match(text, /good game/i);
});

test('promo message keeps a player name on one line', () => {
  const text = registrationBonusText('Hanna\nAdmin', 5000);
  assert.match(text, /ሰላም Hanna Admin!/);
  assert.doesNotMatch(text, /\nAdmin/);
});

test('manual play bonus promo names the player and states the restriction', () => {
  const text = playBonusText('Dawit', 2500);
  assert.match(text, /ሰላም Dawit!/);
  assert.match(text, /25 birr play-only bonus/);
  assert.match(text, /cannot be withdrawn/);
  assert.match(text, /good game/i);
});

test('card purchases use bonus first and then cash', () => {
  assert.deepEqual(splitBonusStake(6000, 1000, 5000), {
    total: 6000,
    bonusUsed: 5000,
    cashUsed: 1000,
    enough: true,
  });
  assert.equal(splitBonusStake(6000, 500, 5000).enough, false);
  assert.deepEqual(splitBonusStake(2000, 0, 5000), {
    total: 2000,
    bonusUsed: 2000,
    cashUsed: 0,
    enough: true,
  });
});

test('refunds return bonus-funded stake before cash', () => {
  assert.deepEqual(splitBonusRefund(3000, 1000), { bonusRefund: 1000, cashRefund: 2000 });
  assert.deepEqual(splitBonusRefund(2000, 5000), { bonusRefund: 2000, cashRefund: 0 });
});
