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

/**
 * Every way a card can reach exactly two patterns: one horizontal row plus a
 * diagonal or the four corners. Both diagonals together count as three
 * patterns, so that combination is never planned.
 */
const TWO_PATTERN_PLANS = ROWS.flatMap((row) =>
  [MAIN_DIAGONAL, UPWARD_DIAGONAL, FOUR_CORNERS].map((second) => [...row, ...second]),
);

function maxPatterns(cards, calledSet) {
  let best = 0;
  for (const card of cards || []) {
    best = Math.max(best, completedPatterns(card, calledSet).length);
  }
  return best;
}

/**
 * The two-pattern plan with the fewest numbers still to call, across all of
 * the forced player's cards. Recomputed every draw, so it adapts when the
 * normal draw happens to complete part of another plan.
 */
function bestPlanMissing(cards, calledSet) {
  let best = null;
  for (const card of cards || []) {
    for (const cells of TWO_PATTERN_PLANS) {
      const missing = new Set();
      for (const [col, row] of cells) {
        const number = card?.[col]?.[row];
        if (number && !calledSet.has(number)) missing.add(number);
      }
      // Prefer plans that finish at exactly two patterns. A row that also
      // completes the second diagonal would finish with three or four.
      const finished = new Set([...calledSet, ...missing]);
      const extra = completedPatterns(card, finished).length > 2 ? 1 : 0;
      if (!best || extra < best.extra || (extra === best.extra && missing.size < best.missing.size)) {
        best = { extra, missing };
      }
    }
  }
  return best?.missing || new Set();
}

/** Lowest opponent risk first, then the deck's own shuffled (pop) order. */
function rankNatural(a, b) {
  return a.opponentWins - b.opponentWins || b.index - a.index;
}

/**
 * Planned forced win that looks like a normal round:
 * - the numbers the forced card still needs for exactly two patterns are
 *   spread randomly across the round, with the last one reserved for the
 *   target call;
 * - every other call is an ordinary shuffled draw that never gives the forced
 *   player bingo early;
 * - once the forced player has bingo, calls avoid their card so a slow claim
 *   does not pile up extra lines.
 */
function choosePlannedNumber({ deck, calledSet, players, forcedPlayer, target, random }) {
  const cards = forcedPlayer.cards || [];
  const drawNumber = calledSet.size;
  const candidates = [];
  deck.forEach((number, index) => {
    if (calledSet.has(number)) return;
    const projected = new Set(calledSet);
    projected.add(number);
    candidates.push({
      number,
      index,
      projected,
      onForcedCard: cards.some((card) => cardHasNumber(card, number)),
      forcedBingo: cardHasBingo(cards, projected),
      opponentWins: opponentCompletions(players, forcedPlayer, calledSet, projected),
    });
  });
  if (!candidates.length) return null;

  const pick = (pool) => (pool.length ? [...pool].sort(rankNatural)[0].number : null);

  if (cardHasBingo(cards, calledSet)) {
    return pick(candidates.filter((c) => !c.onForcedCard)) ?? pick(candidates);
  }

  const remaining = bestPlanMissing(cards, calledSet);
  const callsLeft = Math.max(1, target - drawNumber); // includes this call
  const filler = () =>
    pick(candidates.filter((c) => !remaining.has(c.number) && !c.forcedBingo)) ??
    pick(candidates.filter((c) => !c.forcedBingo));

  if (remaining.size <= 1) {
    if (callsLeft > 1) return filler() ?? pick(candidates);
    // Target call: finish with as few patterns as possible (normally exactly
    // two). If finishing now would also hand a real player bingo, wait a call.
    const finishers = candidates
      .filter((c) => c.forcedBingo)
      .map((c) => ({ ...c, patterns: maxPatterns(cards, c.projected) }))
      .sort((a, b) => a.opponentWins - b.opponentWins || a.patterns - b.patterns || b.index - a.index);
    const clean = finishers.find((c) => c.opponentWins === 0 && c.patterns === 2);
    if (clean) return clean.number;
    // Rather than finish with three or four lines (or hand a real player
    // bingo), wait a few calls; only give up on that well past the target.
    const overdue = drawNumber - target >= 10;
    const safe = finishers.find((c) => c.opponentWins === 0);
    if (overdue && safe) return safe.number;
    return filler() ?? safe?.number ?? finishers[0]?.number ?? pick(candidates);
  }

  // Spread the remaining plan numbers (except the last) over the calls before
  // the target, so the forced card fills at a natural pace.
  const spread = remaining.size - 1;
  const slots = Math.max(1, callsLeft - 1);
  const needPlan = spread >= slots || random() < spread / slots;
  if (needPlan) {
    const planPick = pick(
      candidates.filter((c) => remaining.has(c.number) && !c.forcedBingo && c.opponentWins === 0),
    );
    if (planPick != null) return planPick;
  }
  return filler() ?? pick(candidates);
}

/**
 * Chooses the next number when a forced winner is active.
 *
 * Without a plan (`targetCalled` 0) it keeps the original behaviour: only
 * numbers printed on the forced player's card are considered. With a plan the
 * engine builds a normal-looking two-pattern win that lands on the target call
 * (see choosePlannedNumber).
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
  random = Math.random,
}) {
  if (!forcedPlayer || !Array.isArray(deck) || deck.length === 0) return null;

  const calledSet = called instanceof Set ? called : new Set(called || []);
  const target = Math.max(0, Math.floor(Number(targetCalled) || 0));
  if (target > 0) {
    return choosePlannedNumber({ deck, calledSet, players, forcedPlayer, target, random });
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

  const pool = candidates.filter((candidate) => candidate.onForcedCard);
  if (!pool.length) return null;
  pool.sort(rankTowardWin);
  return pool[0].number;
}
