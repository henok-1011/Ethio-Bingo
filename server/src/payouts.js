/**
 * Pure payout math for a finished round. Money is integer santim.
 *
 * Real stakes plus every bot seat form the gross pot. The platform keeps
 * `platformFeeRate` of it and the rest is the prize pool, split evenly between
 * the real (non-bot) players who completed at least two winning patterns.
 * Bots can win a round but never receive money.
 */
export function computePayout({ stakes, platformFeeRate, realWinnerCount }) {
  const safeStakes = Math.max(0, Math.floor(Number(stakes) || 0));
  const feeRate = Math.min(1, Math.max(0, Number(platformFeeRate) || 0));
  const winners = Math.max(0, Math.floor(Number(realWinnerCount) || 0));

  const pool = Math.floor(safeStakes * (1 - feeRate));
  const platformFee = safeStakes - pool;
  const share = winners > 0 ? Math.floor(pool / winners) : 0;

  return { pool, platformFee, share };
}

/**
 * Settle a finished round. `stakes` is the displayed/prize pot and may include
 * bot seats; `cashStakes` is the real money actually collected. A round with no
 * real winner has no prize pool: the real stakes are retained by the platform.
 * When a real winner is paid from a bot-funded pot, the platform fee is floored
 * at zero instead of reporting a negative cash balance.
 */
export function settleRound({ stakes, cashStakes = stakes, platformFeeRate, realWinnerCount }) {
  const safeStakes = Math.max(0, Math.floor(Number(stakes) || 0));
  const safeCash = Math.max(0, Math.floor(Number(cashStakes) || 0));
  const winners = Math.max(0, Math.floor(Number(realWinnerCount) || 0));
  if (winners === 0) return { pool: 0, platformFee: safeCash, share: 0 };

  const result = computePayout({ stakes: safeStakes, platformFeeRate, realWinnerCount: winners });
  const paid = result.share * winners;
  return { ...result, platformFee: Math.max(0, safeCash - paid) };
}

export function totalRealStakes(players) {
  return (players || [])
    .filter((p) => !p.isBot)
    .reduce((sum, p) => sum + Math.max(0, Number(p.paidStake) || 0), 0);
}

/**
 * The prize pot counts every occupied seat, including bot seats. Bots have no
 * real paidStake, so each bot card contributes the current round stake.
 */
export function totalPrizeStakes(players, stake) {
  const seatStake = Math.max(0, Math.floor(Number(stake) || 0));
  return (players || []).reduce((sum, p) => {
    if (!p.isBot) return sum + Math.max(0, Number(p.paidStake) || 0);
    const cards = Math.max(1, Array.isArray(p.cards) ? p.cards.length : 1);
    return sum + seatStake * cards;
  }, 0);
}
