/**
 * Payout math for a finished round. Money is integer santim.
 *
 * The player-facing pot (`totalPrizeStakes` / `projectedPrizeStakes`) counts
 * every occupied seat and may include bot seats. That advertised figure is the
 * platform's payout commitment: when a real player wins, settlement pays the
 * whole pot to the real winner(s). The platform keeps its fee on real stakes;
 * if bot seats funded part of the pot, the difference is recorded as a
 * negative platform fee (a platform top-up). Bot wins still pay nothing.
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

function splitPrize(pool, winners) {
  const base = Math.floor(pool / winners);
  const remainder = pool % winners;
  return Array.from({ length: winners }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Settle a finished round against its advertised prize pot.
 *
 * `prizePool` is the figure shown to players during the round. A round with
 * real winners pays that full pot, split as evenly as possible among them.
 * `cashStakes` is only what was actually collected from real players, so a
 * bot-funded pot produces a negative `platformFee`: the platform is covering
 * the difference. If only bots win, no real payout is made and the platform
 * keeps the real cash.
 */
export function settleRound({ cashStakes, prizePool, realWinnerCount }) {
  const safeCash = Math.max(0, Math.floor(Number(cashStakes) || 0));
  const advertisedPot = Math.max(0, Math.floor(Number(prizePool) || 0));
  const winners = Math.max(0, Math.floor(Number(realWinnerCount) || 0));
  if (winners === 0) return { pool: 0, platformFee: safeCash, shares: [] };

  const shares = splitPrize(advertisedPot, winners);
  const paid = shares.reduce((sum, share) => sum + share, 0);
  return { pool: advertisedPot, platformFee: safeCash - paid, shares };
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
