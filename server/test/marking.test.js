import test from 'node:test';
import assert from 'node:assert/strict';
import { cardHasBingo, cardsHaveBingo, completedPatterns } from '../src/bingo.js';
import {
  cardHasNumber,
  emptyMarks,
  markCalledNumbers,
  markCard,
  markedSet,
  unmarkCard,
} from '../src/marking.js';

const CARD_A = [
  [1, 2, 3, 4, 5],
  [16, 17, 18, 19, 20],
  [31, 32, 0, 34, 35],
  [46, 47, 48, 49, 50],
  [61, 62, 63, 64, 65],
];

const CARD_B = [
  [6, 7, 8, 9, 10],
  [21, 22, 23, 24, 25],
  [36, 37, 0, 39, 40],
  [51, 52, 53, 54, 55],
  [66, 67, 68, 69, 70],
];

function numberNotOn(card) {
  for (let number = 1; number <= 75; number += 1) {
    if (!cardHasNumber(card, number)) return number;
  }
  return null;
}

test('auto marking adds called numbers that are on the card and ignores others', () => {
  const cards = [CARD_A];
  const marks = emptyMarks(cards);
  const missing = numberNotOn(CARD_A);

  assert.equal(markCalledNumbers(cards, marks, new Set([1, 65, missing])), true);
  assert.equal(marks[0].has(1), true);
  assert.equal(marks[0].has(65), true);
  assert.equal(marks[0].has(missing), false);
  assert.equal(markedSet(marks).size, 2);

  // A repeat call does not create duplicate work.
  assert.equal(markCalledNumbers(cards, marks, new Set([1, 65])), false);
});

test('manual marking only records a matching cell on the selected card', () => {
  const cards = [CARD_A, CARD_B];
  const marks = emptyMarks(cards);

  assert.equal(markCard(cards, marks, 0, 1), true);
  assert.equal(marks[0].has(1), true);
  assert.equal(marks[1].has(1), false);
  assert.equal(markCard(cards, marks, 0, 1), false);

  // 6 is on card B only, not card A.
  assert.equal(markCard(cards, marks, 0, 6), false);
  assert.equal(markCard(cards, marks, 1, 6), true);
  assert.equal(markCard(cards, marks, 2, 6), false);
  assert.equal(markCard(cards, marks, 1, 0), false);
});

test('a manual mark can be removed with a second tap', () => {
  const cards = [CARD_A];
  const marks = emptyMarks(cards);

  assert.equal(markCard(cards, marks, 0, 1), true);
  assert.equal(unmarkCard(cards, marks, 0, 1), true);
  assert.equal(marks[0].has(1), false);
  assert.equal(unmarkCard(cards, marks, 0, 1), false);

  // Only a number on the card can be unmarked.
  assert.equal(unmarkCard(cards, marks, 0, 6), false);
  assert.equal(unmarkCard(cards, marks, 1, 1), false);
});

test('player bingo is checked card by card, not by mixing marks', () => {
  const cards = [CARD_A, CARD_A];
  const marks = [
    new Set([1, 16, 31, 46, 5, 65]),
    new Set([1, 16, 31, 46, 61]),
  ];
  const union = markedSet(marks);

  // Neither card has two patterns, but combining both cards' marks does.
  assert.deepEqual(completedPatterns(CARD_A, union).sort(), ['fourCorners', 'horizontal']);
  assert.equal(cardHasBingo(cards, union), true);
  assert.equal(cardsHaveBingo(cards, marks), false);

  // One card completing both patterns is a real win.
  marks[0].add(61);
  assert.equal(cardsHaveBingo(cards, marks), true);
});

test('two marked patterns win even when the called list is not passed in', () => {
  const cards = [CARD_A];
  const marks = emptyMarks(cards);

  // Top row plus the four corners: horizontal + four corners.
  for (const number of [1, 16, 31, 46, 61, 5, 65]) {
    assert.equal(markCard(cards, marks, 0, number), true);
  }
  const marked = markedSet(marks);
  assert.deepEqual(completedPatterns(CARD_A, marked).sort(), ['fourCorners', 'horizontal']);
  assert.equal(cardHasBingo(cards, marked), true);

  // One row alone is still not enough.
  const oneRow = markedSet(emptyMarks(cards));
  for (const number of [1, 16, 31, 46, 61]) oneRow.add(number);
  assert.equal(cardHasBingo(cards, oneRow), false);
});
