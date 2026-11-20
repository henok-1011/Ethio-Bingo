/**
 * Per-card marking helpers.
 *
 * A player's marks are one Set per card. Auto Marking players receive called
 * numbers automatically; manual players add them one tap at a time. Winner
 * checks always read these marks, never the public called-number list.
 */

export function emptyMarks(cards = []) {
  return cards.map(() => new Set());
}

export function cardHasNumber(card, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return false;
  return (card || []).some((column) => Array.isArray(column) && column.includes(n));
}

export function markCard(cards, marks, cardIndex, number) {
  const index = Number(cardIndex);
  const n = Number(number);
  if (!Number.isInteger(index) || index < 0 || index >= (cards?.length || 0)) return false;
  if (!Number.isInteger(n) || n <= 0) return false;
  if (!marks?.[index] || !cardHasNumber(cards[index], n) || marks[index].has(n)) return false;
  marks[index].add(n);
  return true;
}

export function unmarkCard(cards, marks, cardIndex, number) {
  const index = Number(cardIndex);
  const n = Number(number);
  if (!Number.isInteger(index) || index < 0 || index >= (cards?.length || 0)) return false;
  if (!Number.isInteger(n) || n <= 0) return false;
  if (!marks?.[index] || !cardHasNumber(cards[index], n) || !marks[index].has(n)) return false;
  marks[index].delete(n);
  return true;
}

/** Adds every called number that appears on the supplied cards. */
export function markCalledNumbers(cards, marks, calledNumbers) {
  const called = calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers || []);
  let changed = false;
  (cards || []).forEach((card, index) => {
    if (!marks[index]) marks[index] = new Set();
    for (const number of called) {
      if (cardHasNumber(card, number) && !marks[index].has(number)) {
        marks[index].add(number);
        changed = true;
      }
    }
  });
  return changed;
}

/** Union of all cards' marks, used for a player-wide winner check. */
export function markedSet(marks = []) {
  const union = new Set();
  for (const cardsMarks of marks) {
    for (const number of cardsMarks) union.add(number);
  }
  return union;
}
