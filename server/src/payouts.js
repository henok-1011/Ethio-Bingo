/**
 * Payout math for a finished round. Money is integer santim.
 *
 * Two different pots exist:
 * - the player-facing pot (`totalPrizeStakes` / `projectedPrizeStakes`), which
 *   counts every occupied seat and may include bot seats;
 * - the real pot (`totalRealStakes`), which is the money actually collected.
 *
 * Settlement only ever uses the real pot: the platform keeps `platformFeeRate`
 * of it and the rest is split evenly between the real (non-bot) players who
 * completed at least two winning patterns. Bot seats never fund a payout.
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
 * Settle a finished round against real money only.
 *
 * `cashStakes` is the real money actually collected from players. The
 * player-facing pot may include bot seats, so it never enters this
 * calculation: a real winner is paid `1 - platformFeeRate` of the real cash and
 * the platform keeps the remainder. A round with no real winner has no prize
 * pool, so the platform keeps all of the real cash.
 */
export function settleRound({ cashStakes, platformFeeRate, realWinnerCount }) {
  const safeCash = Math.max(0, Math.floor(Number(cashStakes) || 0));
  const winners = Math.max(0, Math.floor(Number(realWinnerCount) || 0));
  if (winners === 0) return { pool: 0, platformFee: safeCash, share: 0 };

  const result = computePayout({ stakes: safeCash, platformFeeRate, realWinnerCount: winners });
  const paid = result.share * winners;
  // Settlement rounding remainders stay with the platform, so the fee is
  // always at least `platformFeeRate` of the real cash and never negative.
  return { ...result, platformFee: safeCash - paid };
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

/**
 * The pot a waiting round will actually pay once auto-mode removes the bots
 * replaced by real cards. Without this projection the live pot counts both the
 * bot and the real card for the same seat until kickoff, then drops.
 */
export function projectedPrizeStakes({
  players = [],
  stake,
  botAuto = false,
  botFloor = 0,
  realCardsDelta = 0,
  realStakeDelta = 0,
} = {}) {
  const seatStake = Math.max(0, Math.floor(Number(stake) || 0));
  const realPlayers = (players || []).filter((p) => !p.isBot);
  const realCards = Math.max(
    0,
    realPlayers.reduce((sum, p) => sum + Math.max(0, p.cards?.length || 0), 0) +
      Math.floor(Number(realCardsDelta) || 0),
  );
  const realStakes = Math.max(
    0,
    realPlayers.reduce((sum, p) => sum + Math.max(0, Number(p.paidStake) || 0), 0) +
      Math.floor(Number(realStakeDelta) || 0),
  );
  const bots = (players || []).filter((p) => p.isBot);
  if (!botAuto) return realStakes + bots.length * seatStake;

  const removable = bots.filter((p) => !p.forced).length;
  const room = Math.max(0, bots.length - Math.max(0, Math.floor(Number(botFloor) || 0)));
  const replaced = Math.min(realCards, room, removable);
  return realStakes + (bots.length - replaced) * seatStake;
}
