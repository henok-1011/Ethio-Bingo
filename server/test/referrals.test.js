import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CARD_COMMISSION_SANTIM,
  cardCommissionNote,
  cardPurchaseCommissionSantim,
  makeReferralCode,
} from '../src/agents.js';

test('agent commission is exactly 50 santim per successful card purchase', () => {
  assert.equal(AGENT_CARD_COMMISSION_SANTIM, 50);
  assert.equal(cardPurchaseCommissionSantim(0), 0);
  assert.equal(cardPurchaseCommissionSantim(1), 50);
  assert.equal(cardPurchaseCommissionSantim(3), 150);
  assert.equal(cardPurchaseCommissionSantim(10), 500);
});

test('commission notes identify the game and card for audit and reversal', () => {
  assert.equal(cardCommissionNote(12, 34), '[game:12] Card #34');
});

test('referral codes are uppercase, short and prefixed by the name', () => {
  const code = makeReferralCode('Selam');
  assert.match(code, /^SELA[0-9A-Z]{5}$/);
  assert.match(makeReferralCode(null), /^AG[0-9A-Z]{5}$/);
});
