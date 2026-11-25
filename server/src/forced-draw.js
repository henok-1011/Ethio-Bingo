import { cardHasBingo, completedPatterns } from './bingo.js';
import { cardHasNumber } from './marking.js';

/**
 * The game counts rows, the two diagonals and the four corners as patterns.
 * These are also the lines used to score how close the forced player is to
 * completing another pattern.
 */
const ROWS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 5 }, (_, col) => [col, row]),
);
const MAIN_DIAGONAL = Array.from({ length: 5 }, (_, i) => [i, i]);
const UPWARD_DIAGONAL = Array.from({ length: 5 }, (_, i) => [i, 4 - i]);
const FOUR_CORNERS = [
  [0, 0],
  [4, 0],
  [0, 4],
  [4, 4],
];

function lineMissing(card, called, line) {
  let missing = 0;
  for (const [col, row] of line) {
    const number = card?.[col]?.[row];
    if (number !== 0 && !called.has(number)) missing += 1;
  }
  return missing;
}

/**
 * Higher scores are better. The forced player's completed pattern count is
 * the main signal; `near` and `progress` break ties between numbers that do
 * not complete a pattern on this call.
 */
function advanceScore(cards, called, candidate) {
  const projected = new Set(called);
  projected.add(candidate);

  let patterns = 0;
  let near = 0;
  let progress = 0;

  for (const card of cards || []) {
    patterns = Math.max(patterns, completedPatterns(card, projected).length);

    // Once a pattern type is already complete, more lines of that type do not
    // help reach a second pattern. Score only lines that can still add one.
    const rowMissing = ROWS.map((line) => lineMissing(card, projected, line));
    const mainMissing = lineMissing(card, projected, MAIN_DIAGONAL);
    const upwardMissing = lineMissing(card, projected, UPWARD_DIAGONAL);
    const cornersMissing = lineMissing(card, projected, FOUR_CORNERS);
    const hasHorizontal = rowMissing.includes(0);

    if (!hasHorizontal) {
      for (const missing of rowMissing) {
        if (missing === 1) near += 1;
        progress += 5 - missing;
      }
    }
    if (mainMissing > 0) {
      if (mainMissing === 1) near += 1;
      progress += 5 - mainMissing;
    }
    if (upwardMissing > 0) {
      if (upwardMissing === 1) near += 1;
      progress += 5 - upwardMissing;
    }
    // Four corners only counts as a pattern while neither diagonal is complete.
    if (mainMissing > 0 && upwardMissing > 0) {
      if (cornersMissing === 1) near += 1;
      progress += 4 - cornersMissing;
    }
  }

  return { patterns, near, progress };
}

/**
 * Counts other real players who would reach two completed patterns with this
 * candidate. The called set is used instead of each player's current marks:
 * a manual player can still tap a called number later, so treating an
 * unmarked number as safe would only postpone the conflict.
 */
function opponentCompletions(players, forcedPlayer, called, projected) {
  let count = 0;
  for (const player of players || []) {
    if (!player || player.isBot || player.id === forcedPlayer.id) continue;
    if (cardHasBingo(player.cards, called)) continue;
    if (cardHasBingo(player.cards, projected)) count += 1;
  }
  return count;
}

function rankTowardWin(a, b) {
  return (
    a.opponentWins - b.opponentWins ||
    b.patterns - a.patterns ||
    b.near - a.near ||
    b.progress - a.progress ||
    a.index - b.index
  );
}

function rankNormalDraw(a, b) {
  return a.opponentWins - b.opponentWins || a.index - b.index;
}

/**
 * Chooses the next number when a forced winner is active.
 *
 * Without a plan (`targetCalled` 0) it keeps the original behaviour: only
 * numbers printed on the forced player's card are considered. The engine now
 * supplies a plan so the win is built over a normal-length round instead of
 * completing in the first few calls:
 *
 * - warm-up: draw normally, but never finish the forced player early;
 * - build: prefer forced-card numbers while still holding the win back;
 * - finish: complete the forced player while avoiding another real winner.
 *
 * Returns null when there is no forced player or no suitable number, allowing
 * the caller to fall back to the normal shuffled deck.
 */
export function chooseForcedNumber({
  deck,
  called,
  players,
  forcedPlayer,
  targetCalled = 0,
  warmupCalls = 0,
}) {
  if (!forcedPlayer || !Array.isArray(deck) || deck.length === 0) return null;

  const calledSet = called instanceof Set ? called : new Set(called || []);
  const target = Math.max(0, Math.floor(Number(targetCalled) || 0));
  const warmup = Math.max(0, Math.floor(Number(warmupCalls) || 0));
  const drawNumber = calledSet.size;

  let phase = 'legacy';
  if (target > 0) {
    if (drawNumber < warmup) phase = 'warmup';
    else if (drawNumber + 1 < target) phase = 'build';
    else phase = 'finish';
  }

  const candidates = [];
  deck.forEach((number, index) => {
    if (calledSet.has(number)) return;

    const projected = new Set(calledSet);
    projected.add(number);
    const onForcedCard = (forcedPlayer.cards || []).some((card) =>
      cardHasNumber(card, number),
    );
    const score = advanceScore(forcedPlayer.cards, calledSet, number);
    candidates.push({
      number,
      index,
      onForcedCard,
      forcedBingo: cardHasBingo(forcedPlayer.cards, projected),
      opponentWins: opponentCompletions(players, forcedPlayer, calledSet, projected),
      ...score,
    });
  });

  if (!candidates.length) return null;

  let pool = [];
  if (phase === 'legacy') {
    pool = candidates.filter((candidate) => candidate.onForcedCard);
  } else if (phase === 'warmup') {
    pool = candidates.filter((candidate) => !candidate.forcedBingo);
  } else if (phase === 'build') {
    pool = candidates.filter((candidate) => candidate.onForcedCard && !candidate.forcedBingo);
    if (!pool.length) pool = candidates.filter((candidate) => !candidate.forcedBingo);
  } else {
    pool = candidates.filter((candidate) => candidate.onForcedCard && candidate.forcedBingo);
    if (!pool.length) pool = candidates.filter((candidate) => candidate.onForcedCard);
    if (!pool.length) pool = candidates.filter((candidate) => candidate.forcedBingo);
  }

  if (!pool.length) {
    if (phase === 'legacy') return null;
    pool = candidates.filter((candidate) => !candidate.forcedBingo);
    if (!pool.length) pool = candidates;
  }

  pool.sort(phase === 'warmup' ? rankNormalDraw : rankTowardWin);
  return pool[0].number;
}
