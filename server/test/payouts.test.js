import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePayout,
  projectedPrizeStakes,
  settleRound,
  totalPrizeStakes,
  totalRealStakes,
} from '../src/payouts.js';
import {
  cardHasBingo,
  completedPatterns,
  generateCard,
  hasLine,
  winningLines,
  winningPatternCells,
} from '../src/bingo.js';

test('platform keeps 20% and the pool splits between real winners', () => {
  // 4 real players at 10 ETB: 4000 santim staked, 20% fee, one winner.
  const one = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 1 });
  assert.equal(one.platformFee, 800);
  assert.equal(one.pool, 3200);
  assert.equal(one.share, 3200);

  // Two real players share the same pool.
  const two = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 2 });
  assert.equal(two.pool, 3200);
  assert.equal(two.share, 1600);
});

test('bots winning means no payout and the pool stays whole', () => {
  const result = computePayout({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 0 });
  assert.equal(result.pool, 3200);
  assert.equal(result.share, 0);
});

test('a round without a real winner keeps all real stakes as platform revenue', () => {
  const result = settleRound({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 0 });
  assert.equal(result.pool, 0);
  assert.equal(result.platformFee, 4000);
  assert.equal(result.share, 0);
});

test('a round with real winners settles the normal fee and pool', () => {
  const result = settleRound({ stakes: 4000, platformFeeRate: 0.2, realWinnerCount: 2 });
  assert.equal(result.pool, 3200);
  assert.equal(result.platformFee, 800);
  assert.equal(result.share, 1600);
});

test('odd pools round down so the platform never pays more than it took', () => {
  const result = computePayout({ stakes: 3999, platformFeeRate: 0.2, realWinnerCount: 3 });
  assert.equal(result.pool, 3199);
  assert.equal(result.share, 1066);
  assert.ok(result.share * 3 <= result.pool);
});

test('bot seats fund the prize pot but not the real cash total', () => {
  const players = [
    { isBot: false, paidStake: 1000, cards: [{}] },
    { isBot: true, paidStake: 0, cards: [{}] },
    { isBot: true, paidStake: 0, cards: [{}] },
    { isBot: false, paidStake: 2000, cards: [{}, {}] },
  ];
  assert.equal(totalRealStakes(players), 3000);
  assert.equal(totalPrizeStakes(players, 1000), 5000);
});

test('the live pot projects the bots that real cards will replace', () => {
  const bots = Array.from({ length: 8 }, () => ({
    isBot: true,
    paidStake: 0,
    cards: [{}],
    forced: false,
  }));
  const real = { isBot: false, paidStake: 2000, cards: [{}] };
  const players = [...bots, real];

  // One real card replaces one bot before calling starts, so the live pot is
  // eight seats rather than the temporary nine-seat count.
  assert.equal(
    projectedPrizeStakes({ players, stake: 2000, botAuto: true, botFloor: 1 }),
    totalPrizeStakes([...bots.slice(1), real], 2000),
  );
  assert.equal(projectedPrizeStakes({ players, stake: 2000, botAuto: true, botFloor: 1 }), 16000);

  // Deselecting the real card restores that bot and leaves the pot unchanged.
  assert.equal(
    projectedPrizeStakes({
      players,
      stake: 2000,
      botAuto: true,
      botFloor: 1,
      realCardsDelta: -1,
      realStakeDelta: -2000,
    }),
    16000,
  );
});

test('manual bots stay in addition to real cards in the live pot', () => {
  const players = [
    { isBot: true, paidStake: 0, cards: [{}] },
    { isBot: true, paidStake: 0, cards: [{}] },
    { isBot: false, paidStake: 2000, cards: [{}] },
  ];
  assert.equal(projectedPrizeStakes({ players, stake: 2000, botAuto: false }), 6000);
});

test('a bot-only win settles without paying any cash', () => {
  // 4 real stakes plus 2 bot seats; the bot wins and no real player is paid.
  const result = settleRound({
    stakes: 6000,
    cashStakes: 4000,
    platformFeeRate: 0.2,
    realWinnerCount: 0,
  });
  assert.equal(result.pool, 0);
  assert.equal(result.share, 0);
  assert.equal(result.platformFee, 4000);
});

test('real winners can receive a bot-funded pot without a negative fee', () => {
  const result = settleRound({
    stakes: 6000,
    cashStakes: 4000,
    platformFeeRate: 0.2,
    realWinnerCount: 1,
  });
  assert.equal(result.pool, 4800);
  assert.equal(result.share, 4800);
  assert.equal(result.platformFee, 0);
});

test('a generated card has 12 ways to win and a free centre', () => {
  const card = generateCard();
  assert.equal(card.length, 5);
  assert.equal(card[2][2], 0);
  assert.equal(winningLines().length, 12);

  // A fresh card is not bingo yet.
  assert.equal(hasLine(card, new Set()), false);

  // Complete the top row.
  const called = new Set([card[0][0], card[1][0], card[2][0], card[3][0], card[4][0]]);
  assert.equal(hasLine(card, called), true);

  // Four of five in a row is not bingo.
  called.delete(card[4][0]);
  assert.equal(hasLine(card, called), false);
});

test('a single completed line is not enough to win', () => {
  const card = generateCard();
  const called = new Set(Array.from({ length: 5 }, (_, col) => card[col][0]));
  assert.deepEqual(completedPatterns(card, called), ['horizontal']);
  assert.equal(cardHasBingo([card], called), false);
});

test('two completed patterns win', () => {
  const card = generateCard();
  const called = new Set(Array.from({ length: 5 }, (_, col) => card[col][0]));
  called.add(card[0][4]);
  called.add(card[4][4]);
  assert.deepEqual(completedPatterns(card, called).sort(), ['fourCorners', 'horizontal']);
  assert.equal(cardHasBingo([card], called), true);
  assert.equal(cardHasBingo([], called), false);
  assert.equal(winningPatternCells(card, called).length, 7);
});

test('one diagonal is only one pattern', () => {
  const card = generateCard();
  const called = new Set();
  for (let i = 0; i < 5; i += 1) called.add(card[i][i]);
  called.delete(0);
  assert.deepEqual(completedPatterns(card, called), ['downward']);
  assert.equal(cardHasBingo([card], called), false);
});

test('both diagonals complete diagonal, upward and downward', () => {
  const card = generateCard();
  const called = new Set();
  for (let i = 0; i < 5; i += 1) {
    called.add(card[i][i]);
    called.add(card[i][4 - i]);
  }
  called.delete(0);
  const patterns = completedPatterns(card, called);
  assert.ok(patterns.includes('diagonal'));
  assert.ok(patterns.includes('upward'));
  assert.ok(patterns.includes('downward'));
  assert.equal(patterns.includes('fourCorners'), false);
  assert.equal(cardHasBingo([card], called), true);
});
