const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
const RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export { COLUMNS, RANGES };

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

/** Cells of every completed pattern; used by the result card for forced wins. */
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

export function letterFor(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  return 'O';
}

export function callLabel(number) {
  if (!number) return '--';
  return `${letterFor(number)}${number}`;
}
