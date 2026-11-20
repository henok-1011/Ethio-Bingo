import test from 'node:test';
import assert from 'node:assert/strict';
import { cardHasBingo } from '../src/bingo.js';
import { chooseForcedNumber } from '../src/forced-draw.js';

// Bingo cards are stored as card[column][row], so transpose readable rows.
function cardFromRows(rows) {
  return rows[0].map((_, col) => rows.map((row) => row[col]));
}

const FORCED_CARD = cardFromRows([
  [1, 2, 3, 4, 5],
  [16, 17, 18, 19, 20],
  [31, 32, 0, 34, 35],
  [46, 47, 48, 49, 50],
  [61, 62, 63, 64, 65],
]);

const OPPONENT_CARD = cardFromRows([
  [1, 6, 7, 8, 9],
  [16, 21, 22, 23, 24],
  [31, 36, 0, 38, 39],
  [46, 51, 52, 53, 54],
  [61, 62, 63, 64, 65],
]);

const OPPONENT_SECOND_CARD = cardFromRows([
  [1, 6, 7, 8, 9],
  [16, 2, 17, 18, 19],
  [31, 32, 0, 34, 35],
  [46, 47, 48, 53, 50],
  [61, 62, 63, 65, 64],
]);

const SAFE_OPPONENT_CARD = cardFromRows([
  [6, 7, 8, 9, 10],
  [21, 22, 23, 24, 25],
  [36, 37, 0, 39, 40],
  [51, 52, 53, 54, 55],
  [66, 67, 68, 69, 70],
]);

function player(id, card, isBot = false) {
  return { id, isBot, cards: [card] };
}

test('chooses a safe forced-card number over one that gives a real player a second pattern', () => {
  const called = new Set([1, 6, 7, 8, 9, 21, 53]);
  const forced = player(1, FORCED_CARD);
  const opponent = player(2, OPPONENT_CARD);

  assert.equal(cardHasBingo(opponent.cards, new Set([...called, 65])), true);
  assert.equal(cardHasBingo(opponent.cards, new Set([...called, 2])), false);

  const number = chooseForcedNumber({
    deck: [65, 2],
    called,
    players: [forced, opponent],
    forcedPlayer: forced,
  });

  assert.equal(number, 2);
});

test('rejects an opponent-winning number even when it would finish the forced player', () => {
  const called = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 21, 49, 53]);
  const forced = player(1, FORCED_CARD);
  const opponent = player(2, OPPONENT_CARD);

  // 65 completes both the forced player and the opponent's second pattern.
  assert.equal(cardHasBingo(forced.cards, new Set([...called, 65])), true);
  assert.equal(cardHasBingo(opponent.cards, new Set([...called, 65])), true);

  const number = chooseForcedNumber({
    deck: [65, 16],
    called,
    players: [forced, opponent],
    forcedPlayer: forced,
  });

  assert.equal(number, 16);
});

test('ignores bot completions because bots are held from claiming', () => {
  const called = new Set([1, 6, 7, 8, 9, 21, 53]);
  const forced = player(1, FORCED_CARD);
  const bot = player(2, OPPONENT_CARD, true);

  assert.equal(cardHasBingo(bot.cards, new Set([...called, 65])), true);

  const number = chooseForcedNumber({
    deck: [65],
    called,
    players: [forced, bot],
    forcedPlayer: forced,
  });

  assert.equal(number, 65);
});

test('when no safe number exists, picks the one completing the fewest real players', () => {
  const called = new Set([1, 6, 7, 8, 9, 21, 53, 64]);
  const forced = player(1, FORCED_CARD);
  const opponentOne = player(2, OPPONENT_CARD);
  const opponentTwo = player(3, OPPONENT_CARD);
  const opponentThree = player(4, OPPONENT_SECOND_CARD);

  // 65 gives two opponents their second pattern; 2 gives only one.
  assert.equal(cardHasBingo(opponentOne.cards, new Set([...called, 65])), true);
  assert.equal(cardHasBingo(opponentTwo.cards, new Set([...called, 65])), true);
  assert.equal(cardHasBingo(opponentThree.cards, new Set([...called, 2])), true);

  const number = chooseForcedNumber({
    deck: [65, 2],
    called,
    players: [forced, opponentOne, opponentTwo, opponentThree],
    forcedPlayer: forced,
  });

  assert.equal(number, 2);
});

test('prefers the number that completes the forced player second pattern', () => {
  const called = new Set([1, 2, 3, 4, 5, 17, 49]);
  const forced = player(1, FORCED_CARD);
  const opponent = player(2, SAFE_OPPONENT_CARD);

  // 65 completes the forced player's main diagonal for their second pattern;
  // 16 is safe but does not complete a pattern yet.
  assert.equal(cardHasBingo(forced.cards, new Set([...called, 65])), true);
  assert.equal(cardHasBingo(forced.cards, new Set([...called, 16])), false);

  const number = chooseForcedNumber({
    deck: [16, 65],
    called,
    players: [forced, opponent],
    forcedPlayer: forced,
  });

  assert.equal(number, 65);
});

test('an opponent first pattern is not treated as a conflict', () => {
  const called = new Set([1, 21, 53]);
  const forced = player(1, FORCED_CARD);
  const opponent = player(2, OPPONENT_CARD);

  // This only completes the opponent's downward diagonal, not a second pattern.
  assert.equal(cardHasBingo(opponent.cards, new Set([...called, 65])), false);

  const number = chooseForcedNumber({
    deck: [65],
    called,
    players: [forced, opponent],
    forcedPlayer: forced,
  });

  assert.equal(number, 65);
});

test('returns null when there is no forced player or no matching card number', () => {
  const forced = player(1, FORCED_CARD);

  assert.equal(
    chooseForcedNumber({ deck: [1], called: new Set(), players: [], forcedPlayer: null }),
    null,
  );
  assert.equal(
    chooseForcedNumber({
      deck: [6],
      called: new Set(),
      players: [forced],
      forcedPlayer: forced,
    }),
    null,
  );
});
