import { prisma } from './db.js';
import { dayKey, daysAgo } from './util.js';

/**
 * Map the free-text provider / bank labels stored on deposits and withdrawals
 * onto the two cash accounts the platform actually operates. Anything else
 * falls into `other` so the per-channel rows still add up to the total.
 */
function cashChannel(...labels) {
  const text = labels.filter(Boolean).join(' ').toLowerCase();
  if (text.includes('telebirr')) return 'telebirr';
  if (text.includes('cbe') || text.includes('commercial bank of ethiopia')) return 'cbe';
  return 'other';
}

/**
 * Prisma filter for the admin phone-registration filter. A phone counts as
 * missing when it is null or blank.
 */
export function phoneStatusWhere(status) {
  const value = String(status || 'all').trim().toLowerCase();
  if (value === 'missing') return { OR: [{ phone: null }, { phone: '' }] };
  if (value === 'registered') return { AND: [{ phone: { not: null } }, { phone: { not: '' } }] };
  return null;
}

export async function adminOverview() {
  const since = daysAgo(13);
  const weekAgo = daysAgo(6);
  const monthAgo = daysAgo(29);

  const [
    transactions,
    games,
    allTimeTotals,
    agentTx,
    usersCount,
    newUsers,
    missingPhones,
    pendingWithdrawals,
    pendingAgentWithdrawals,
    pendingDeposits,
    pendingAgents,
  ] = await Promise.all([
      prisma.transaction.findMany({ where: { createdAt: { gte: since }, status: 'completed' } }),
      prisma.game.findMany({ where: { createdAt: { gte: since } } }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { status: 'completed' },
        _sum: { amount: true },
      }),
      prisma.agentTransaction.findMany({ where: { status: 'completed' } }),
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: phoneStatusWhere('missing') }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.agentWithdrawal.count({ where: { status: 'PENDING' } }),
      prisma.deposit.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.agent.count({ where: { activityBonusPaid: true } }),
    ]);

  const sum = (rows, type) =>
    rows.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);
  const totalByType = (type) =>
    allTimeTotals.find((row) => row.type === type)?._sum.amount || 0;

  const allGames = await prisma.game.findMany({
    where: { status: 'ENDED' },
    select: { stake: true, platformFee: true, prizePool: true, createdAt: true },
  });
  const winAgg = await prisma.transaction.aggregate({
    where: { type: 'win', status: 'completed' },
    _max: { amount: true },
    _sum: { amount: true },
  });

  const activeDaily = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: daysAgo(0) } },
  });
  const activeWeekly = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: weekAgo } },
  });
  const activeMonthly = await prisma.gamePlayer.groupBy({
    by: ['userId'],
    where: { userId: { not: null }, joinedAt: { gte: monthAgo } },
  });

  const cardCommissions = agentTx
    .filter((t) => t.type === 'card_purchase_commission')
    .reduce((acc, t) => acc + t.amount, 0);
  const agentPayouts = agentTx
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);
  const referralBonuses = agentTx
    .filter((t) => ['deposit_bonus', 'activity_bonus', 'gameplay_commission'].includes(t.type))
    .reduce((acc, t) => acc + t.amount, 0);
  const platformFees = allGames.reduce((acc, g) => acc + g.platformFee, 0);

  // Cash reconciliation: only real money movement counts. Verified deposits
  // are what landed in the Telebirr / CBE accounts; approved withdrawals are
  // what was paid out. Wallet and commission balances are money still owed.
  const [
    depositChannels,
    playerWithdrawalChannels,
    agentWithdrawalChannels,
    playerBalanceAgg,
    agentBalanceAgg,
    pendingPlayerWithdrawalAgg,
    pendingAgentWithdrawalAgg,
  ] = await Promise.all([
    prisma.deposit.groupBy({
      by: ['provider', 'paymentMethod'],
      where: { status: 'VERIFIED' },
      _sum: { amount: true },
    }),
    prisma.withdrawal.groupBy({
      by: ['bank'],
      where: { status: 'APPROVED' },
      _sum: { amount: true },
    }),
    prisma.agentWithdrawal.groupBy({
      by: ['bank'],
      where: { status: 'APPROVED' },
      _sum: { amount: true },
    }),
    prisma.user.aggregate({ _sum: { balance: true } }),
    prisma.agent.aggregate({ _sum: { commissionBalance: true } }),
    prisma.withdrawal.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
    prisma.agentWithdrawal.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
  ]);

  const channelTotals = {
    telebirr: { deposits: 0, playerWithdrawals: 0, agentWithdrawals: 0 },
    cbe: { deposits: 0, playerWithdrawals: 0, agentWithdrawals: 0 },
    other: { deposits: 0, playerWithdrawals: 0, agentWithdrawals: 0 },
  };
  for (const row of depositChannels) {
    channelTotals[cashChannel(row.provider, row.paymentMethod)].deposits += row._sum.amount || 0;
  }
  for (const row of playerWithdrawalChannels) {
    channelTotals[cashChannel(row.bank)].playerWithdrawals += row._sum.amount || 0;
  }
  for (const row of agentWithdrawalChannels) {
    channelTotals[cashChannel(row.bank)].agentWithdrawals += row._sum.amount || 0;
  }

  const channels = [
    { id: 'telebirr', label: 'Telebirr' },
    { id: 'cbe', label: 'CBE' },
    { id: 'other', label: 'Unassigned / other banks' },
  ].map((channel) => {
    const entry = channelTotals[channel.id];
    return {
      ...channel,
      ...entry,
      balance: entry.deposits - entry.playerWithdrawals - entry.agentWithdrawals,
    };
  });

  const cashTotals = channels.reduce(
    (acc, channel) => ({
      deposits: acc.deposits + channel.deposits,
      playerWithdrawals: acc.playerWithdrawals + channel.playerWithdrawals,
      agentWithdrawals: acc.agentWithdrawals + channel.agentWithdrawals,
      balance: acc.balance + channel.balance,
    }),
    { deposits: 0, playerWithdrawals: 0, agentWithdrawals: 0, balance: 0 },
  );

  const liabilities = {
    playerBalances: playerBalanceAgg._sum.balance || 0,
    agentBalances: agentBalanceAgg._sum.commissionBalance || 0,
    pendingPlayerWithdrawals: pendingPlayerWithdrawalAgg._sum.amount || 0,
    pendingAgentWithdrawals: pendingAgentWithdrawalAgg._sum.amount || 0,
  };
  const totalLiabilities =
    liabilities.playerBalances +
    liabilities.agentBalances +
    liabilities.pendingPlayerWithdrawals +
    liabilities.pendingAgentWithdrawals;

  const days = [];
  for (let i = 13; i >= 0; i -= 1) days.push(dayKey(daysAgo(i)));

  const series = days.map((day) => {
    const dayTx = transactions.filter((t) => dayKey(t.createdAt) === day);
    const dayGames = games.filter((g) => dayKey(g.createdAt) === day);
    return {
      day,
      deposits: sum(dayTx, 'deposit') / 100,
      withdrawals: sum(dayTx, 'withdrawal') / 100,
      rounds: dayGames.length,
      winPayouts: sum(dayTx, 'win') / 100,
      gmv: sum(dayTx, 'stake') / 100,
    };
  });

  const countsByType = ['deposit', 'withdrawal', 'stake', 'win'].map((type) => ({
    label: type,
    value: transactions.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0) / 100,
  }));

  const avgStake = allGames.length
    ? allGames.reduce((acc, g) => acc + g.stake, 0) / allGames.length / 100
    : 0;
  const avgPrize = allGames.length
    ? allGames.reduce((acc, g) => acc + g.prizePool, 0) / allGames.length / 100
    : 0;

  const roundsWithPlayers = await prisma.game.findMany({
    where: { status: 'ENDED' },
    select: { _count: { select: { players: true } } },
    take: 200,
    orderBy: { id: 'desc' },
  });
  const avgPlayers = roundsWithPlayers.length
    ? roundsWithPlayers.reduce((acc, g) => acc + g._count.players, 0) / roundsWithPlayers.length
    : 0;

  return {
    totals: {
      deposits: totalByType('deposit'),
      withdrawals: totalByType('withdrawal'),
      platformFees,
      agentCommissions: cardCommissions,
      agentPayouts,
      referralBonuses,
      netRevenue: platformFees - agentPayouts,
      winPayouts: winAgg._sum.amount || 0,
      gmv: totalByType('stake'),
      players: usersCount,
      newUsersWeek: newUsers,
      missingPhones,
      agentsWithBonus: pendingAgents,
    },
    active: {
      daily: activeDaily.length,
      weekly: activeWeekly.length,
      monthly: activeMonthly.length,
    },
    gameStats: {
      rounds: allGames.length,
      avgStake,
      avgPrize,
      avgPlayers,
      biggestWin: winAgg._max.amount || 0,
    },
    pending: {
      withdrawals: pendingWithdrawals,
      agentWithdrawals: pendingAgentWithdrawals,
      deposits: pendingDeposits,
    },
    reconciliation: {
      channels,
      totals: cashTotals,
      liabilities: { ...liabilities, total: totalLiabilities },
      net: cashTotals.balance - totalLiabilities,
    },
    series,
    pie: countsByType,
  };
}

const csvEscape = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');

export async function exportCsv(type, { phoneStatus = 'all' } = {}) {
  if (type === 'transactions') {
    const rows = await prisma.transaction.findMany({ orderBy: { id: 'desc' }, take: 5000 });
    return toCsv(
      ['id', 'userId', 'type', 'amountETB', 'status', 'reference', 'meta', 'createdAt'],
      rows.map((t) => [t.id, t.userId, t.type, t.amount / 100, t.status, t.reference, t.meta, t.createdAt.toISOString()]),
    );
  }
  if (type === 'withdrawals') {
    const rows = await prisma.withdrawal.findMany({ orderBy: { id: 'desc' }, take: 5000 });
    return toCsv(
      ['id', 'userId', 'amountETB', 'bank', 'accountNumber', 'accountName', 'status', 'adminNotes', 'createdAt'],
      rows.map((w) => [w.id, w.userId, w.amount / 100, w.bank, w.accountNumber, w.accountName, w.status, w.adminNotes, w.createdAt.toISOString()]),
    );
  }
  if (type === 'agents') {
    const rows = await prisma.agent.findMany({ include: { user: true } });
    return toCsv(
      ['agentId', 'name', 'referralCode', 'activeReferrals', 'commissionBalanceETB', 'totalEarnedETB', 'activityBonusPaid', 'isActive'],
      rows.map((a) => [
        a.id,
        a.user.firstName || a.user.username,
        a.referralCode,
        a.activeReferralCount,
        a.commissionBalance / 100,
        a.totalEarned / 100,
        a.activityBonusPaid,
        a.isActive,
      ]),
    );
  }
  const phoneWhere = phoneStatusWhere(phoneStatus);
  const rows = await prisma.user.findMany({
    where: phoneWhere || {},
    orderBy: { id: 'desc' },
    take: 5000,
  });
  return toCsv(
    ['id', 'telegramId', 'username', 'firstName', 'phone', 'balanceETB', 'derash', 'role', 'referredByAgentId', 'isBanned', 'hasPlayed', 'createdAt'],
    rows.map((u) => [
      u.id,
      u.telegramId,
      u.username,
      u.firstName,
      u.phone,
      u.balance / 100,
      u.derash,
      u.role,
      u.referredByAgentId,
      u.isBanned,
      u.hasPlayed,
      u.createdAt.toISOString(),
    ]),
  );
}
