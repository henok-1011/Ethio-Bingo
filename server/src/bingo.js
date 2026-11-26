/**
 * 75-ball bingo card logic.
 * A card is stored as 5 columns (B, I, N, G, O) of 5 numbers each, so
 * card[col][row]. Numbers are unique per column and drawn from its range.
 */
const COLUMN_RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export const COLUMN_LABELS = ['B', 'I', 'N', 'G', 'O'];

function sample(range, count, random) {
  const pool = [];
  for (let n = range[0]; n <= range[1]; n += 1) pool.push(n);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Small deterministic PRNG so card #N always holds the same numbers inside a round.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a card. Pass a numeric seed to get a repeatable card for a slot;
 * omit it for a random card.
 */
export function generateCard(seed = null) {
  const random = seed === null ? Math.random : mulberry32(seed);
  const card = COLUMN_RANGES.map((range) => sample(range, 5, random));
  card[2][2] = 0; // free space
  return card;
}

export function isMarked(card, calledSet) {
  return card.map((column) => column.map((n) => n === 0 || calledSet.has(n)));
}

/**
 * All 12 winning lines on a 5x5 grid as [col, row] pairs.
 */
export function winningLines() {
  const lines = [];
  for (let row = 0; row < 5; row += 1) {
    lines.push(Array.from({ length: 5 }, (_, col) => [col, row]));
  }
  for (let col = 0; col < 5; col += 1) {
    lines.push(Array.from({ length: 5 }, (_, row) => [col, row]));
  }
  lines.push(Array.from({ length: 5 }, (_, i) => [i, i]));
  lines.push(Array.from({ length: 5 }, (_, i) => [i, 4 - i]));
  return lines;
}

const LINES = winningLines();

const MAIN_DIAGONAL = Array.from({ length: 5 }, (_, i) => [i, i]);
const UPWARD_DIAGONAL = Array.from({ length: 5 }, (_, i) => [i, 4 - i]);
const FOUR_CORNERS = [
  [0, 0],
  [4, 0],
  [0, 4],
  [4, 4],
];

function cellsAreMarked(card, calledSet, cells) {
  return cells.every(([col, row]) => {
    const number = card?.[col]?.[row];
    return number === 0 || calledSet.has(number);
  });
}

function completedRows(card, calledSet) {
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => [col, row]),
  ).filter((cells) => cellsAreMarked(card, calledSet, cells));
}

export function completedPatterns(card, calledSet = new Set()) {
  const main = cellsAreMarked(card, calledSet, MAIN_DIAGONAL);
  const upward = cellsAreMarked(card, calledSet, UPWARD_DIAGONAL);
  const rows = completedRows(card, calledSet);
  const patterns = [];
  if (main && upward) patterns.push('diagonal');
  if (upward) patterns.push('upward');
  if (main) patterns.push('downward');
  // A diagonal already includes all four corners. Counting four corners again
  // would let one diagonal satisfy two types and win by itself.
  if (!main && !upward && cellsAreMarked(card, calledSet, FOUR_CORNERS)) {
    patterns.push('fourCorners');
  }
  if (rows.length) patterns.push('horizontal');
  return patterns;
}

export function patternCount(card, calledSet = new Set()) {
  return completedPatterns(card, calledSet).length;
}

export function hasWinningPatterns(card, calledSet = new Set()) {
  return patternCount(card, calledSet) >= 2;
}

function cellsForPatterns(card, calledSet, patterns) {
  const cells = [];
  if (patterns.includes('diagonal')) cells.push(...MAIN_DIAGONAL, ...UPWARD_DIAGONAL);
  if (patterns.includes('upward')) cells.push(...UPWARD_DIAGONAL);
  if (patterns.includes('downward')) cells.push(...MAIN_DIAGONAL);
  if (patterns.includes('fourCorners')) cells.push(...FOUR_CORNERS);
  if (patterns.includes('horizontal')) cells.push(...completedRows(card, calledSet).flat());
  const unique = new Map();
  for (const [col, row] of cells) unique.set(col + '-' + row, [col, row]);
  return [...unique.values()];
}

/**
 * Every cell that belongs to a completed pattern, even when the card has only
 * one (a forced win). Columns are not winning patterns, so a completed column
 * is never highlighted.
 */
export function completedPatternCells(card, calledSet = new Set()) {
  const patterns = completedPatterns(card, calledSet);
  if (!patterns.length) return null;
  return cellsForPatterns(card, calledSet, patterns);
}

export function winningPatternCells(card, calledSet = new Set()) {
  const patterns = completedPatterns(card, calledSet);
  if (patterns.length < 2) return null;
  return cellsForPatterns(card, calledSet, patterns);
}

/**
 * Picks the card that actually won. A player can hold several cards, so prefer
 * the one with two completed patterns; only a forced win falls back to the
 * first card with a single completed pattern.
 */
export function winningCardFor(cards, markedSets = []) {
  const list = cards || [];
  let fallback = null;
  for (let index = 0; index < list.length; index += 1) {
    const marks = markedSets[index] || new Set();
    const line = winningPatternCells(list[index], marks);
    if (line) return { index, line };
    if (!fallback) {
      const completed = completedPatternCells(list[index], marks);
      if (completed) fallback = { index, line: completed };
    }
  }
  return fallback;
}

function lineComplete(card, calledSet, line) {
  return line.every(([col, row]) => {
    const n = card[col][row];
    return n === 0 || calledSet.has(n);
  });
}

export function hasLine(card, calledSet) {
  return LINES.some((line) => lineComplete(card, calledSet, line));
}

/**
 * Returns the first completed line on a card as [col, row] pairs, or null.
 * Used by the winner screen to highlight the winning selection.
 */
export function winningLineFor(card, calledSet) {
  return LINES.find((line) => lineComplete(card, calledSet, line)) || null;
}

export function cardHasBingo(cards, calledSet) {
  return (cards || []).some((card) => hasWinningPatterns(card, calledSet));
}

/**
 * Each card must win on its own marks. Passing one combined set would let
 * numbers marked on different cards complete a pattern that no card owns.
 */
export function cardsHaveBingo(cards, markedSets = []) {
  return (cards || []).some((card, index) =>
    hasWinningPatterns(card, markedSets[index] || new Set()),
  );
}

export function shuffleDeck() {
  const deck = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function columnOf(number) {
  if (number >= 1 && number <= 15) return 0;
  if (number <= 30) return 1;
  if (number <= 45) return 2;
  if (number <= 60) return 3;
  return 4;
}
