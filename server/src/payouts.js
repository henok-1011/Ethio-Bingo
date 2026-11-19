/**
 * Pure payout math for a finished round. Money is integer santim.
 *
 * Players' stakes form the pot. The platform keeps `platformFeeRate` of it and
 * the rest is the prize pool, split evenly between the real (non-bot) players
 * who completed at least two winning patterns. Bots can win a round but never
 * receive money.
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
 * Settle a finished round. A round with no real winner has no prize pool:
 * the real stakes are retained by the platform, so reporting the full amount
 * as platform revenue keeps the ledger and the admin money flow accurate.
 */
export function settleRound({ stakes, platformFeeRate, realWinnerCount }) {
  const safeStakes = Math.max(0, Math.floor(Number(stakes) || 0));
  const winners = Math.max(0, Math.floor(Number(realWinnerCount) || 0));
  if (winners === 0) return { pool: 0, platformFee: safeStakes, share: 0 };
  return computePayout({ stakes: safeStakes, platformFeeRate, realWinnerCount: winners });
}

export function totalRealStakes(players) {
  return (players || [])
    .filter((p) => !p.isBot)
    .reduce((sum, p) => sum + Math.max(0, Number(p.paidStake) || 0), 0);
}
