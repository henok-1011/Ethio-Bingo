import { prisma } from './db.js';
import { emitToUser } from './realtime.js';

/** Fixed agent commission for every successful card purchase. */
export const AGENT_CARD_COMMISSION_SANTIM = 50;

export function cardPurchaseCommissionSantim(cardCount = 1) {
  const count = Math.max(0, Math.floor(Number(cardCount) || 0));
  return count * AGENT_CARD_COMMISSION_SANTIM;
}

export function cardCommissionNote(gameId, slot) {
  return `[game:${gameId}] Card #${slot}`;
}

export function makeReferralCode(firstName) {
  const base = String(firstName || 'AG')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'AG';
  return `${base}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export async function uniqueReferralCode(firstName) {
  for (let i = 0; i < 10; i += 1) {
    const code = makeReferralCode(firstName);
    const exists = await prisma.agent.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  return `AG${Date.now().toString(36).toUpperCase()}`;
}

/** Promote a user to agent. The referral code is permanent; attribution of
 * referred users is stored on the user row and never overwritten. */
export async function createAgentForUser(user, staffId = null) {
  const existing = await prisma.agent.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const referralCode = await uniqueReferralCode(user.firstName);
  const agent = await prisma.agent.create({
    data: { userId: user.id, referralCode },
  });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'agent' } });
  if (staffId) {
    await prisma.adminAction.create({
      data: { staffId, actionType: 'agent_promote', details: `user:${user.id} code:${referralCode}` },
    });
  }
  return agent;
}

export async function linkReferral(user, rawCode) {
  if (!rawCode || user.referredByAgentId) return null;
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return null;
  const agent = await prisma.agent.findUnique({ where: { referralCode: code }, include: { user: true } });
  if (!agent || !agent.isActive) return null;
  if (agent.userId === user.id) return null; // self-referral guard
  if (!agent.user || agent.user.isBanned) return null;

  const already = await prisma.referral.findUnique({ where: { userId: user.id } });
  if (already) return null;

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { referredByAgentId: agent.id } }),
    prisma.referral.create({ data: { agentId: agent.id, userId: user.id } }),
  ]);
  return agent;
}

/**
 * Credits 0.50 ETB for every successfully purchased card. The returned array
 * is aligned with the purchased card slots so a deselection can reverse the
 * exact transaction later.
 */
export async function creditCardPurchaseCommissions({ user, gameId, slots }) {
  const cardSlots = Array.isArray(slots)
    ? slots.map((slot) => Math.floor(Number(slot))).filter((slot) => Number.isFinite(slot))
    : [];
  if (!user?.referredByAgentId || cardSlots.length === 0) {
    return cardSlots.map(() => null);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const total = cardPurchaseCommissionSantim(cardSlots.length);
      const agent = await tx.agent.update({
        where: { id: user.referredByAgentId },
        data: {
          commissionBalance: { increment: total },
          totalEarned: { increment: total },
        },
      });

      const transactionIds = [];
      for (const slot of cardSlots) {
        const row = await tx.agentTransaction.create({
          data: {
            agentId: agent.id,
            type: 'card_purchase_commission',
            amount: AGENT_CARD_COMMISSION_SANTIM,
            referenceUserId: user.id,
            status: 'completed',
            note: cardCommissionNote(gameId, slot),
          },
        });
        transactionIds.push(row.id);
      }
      return { agent, transactionIds };
    });

    emitToUser(result.agent.userId, 'agent:balance', {
      commissionBalance: result.agent.commissionBalance,
    });
    return result.transactionIds;
  } catch (err) {
    console.error('[agents] card purchase commission failed:', err.message);
    return cardSlots.map(() => null);
  }
}

/** Reverses one card-purchase commission when that card is refunded. */
export async function reverseCardPurchaseCommission(transactionId, { referenceUserId = null, note = null } = {}) {
  const id = Math.floor(Number(transactionId));
  if (!Number.isInteger(id) || id <= 0) return false;

  try {
    const agent = await prisma.$transaction(async (tx) => {
      const original = await tx.agentTransaction.findFirst({
        where: { id, type: 'card_purchase_commission', status: 'completed' },
      });
      if (!original) return null;

      await tx.agentTransaction.update({
        where: { id: original.id },
        data: { status: 'reversed' },
      });
      await tx.agentTransaction.create({
        data: {
          agentId: original.agentId,
          type: 'card_purchase_reversal',
          amount: -Math.abs(original.amount),
          referenceUserId: referenceUserId ?? original.referenceUserId,
          status: 'completed',
          note: note || `Reversal of commission #${original.id}`,
        },
      });
      return tx.agent.update({
        where: { id: original.agentId },
        data: {
          commissionBalance: { decrement: Math.abs(original.amount) },
          totalEarned: { decrement: Math.abs(original.amount) },
        },
      });
    });

    if (!agent) return false;
    emitToUser(agent.userId, 'agent:balance', { commissionBalance: agent.commissionBalance });
    return true;
  } catch (err) {
    console.error('[agents] card purchase commission reversal failed:', err.message);
    return false;
  }
}

/** Reverses every still-active card commission from an interrupted round. */
export async function reverseCardPurchaseCommissionsForGame(gameId, userId) {
  const id = Math.floor(Number(gameId));
  if (!Number.isInteger(id) || id <= 0 || !userId) return 0;

  const rows = await prisma.agentTransaction.findMany({
    where: {
      referenceUserId: userId,
      type: 'card_purchase_commission',
      status: 'completed',
      note: { contains: `[game:${id}]` },
    },
    select: { id: true },
  });

  let reversed = 0;
  for (const row of rows) {
    if (
      await reverseCardPurchaseCommission(row.id, {
        referenceUserId: userId,
        note: `Round ${id} refunded`,
      })
    ) {
      reversed += 1;
    }
  }
  return reversed;
}

/** Marks a referred player active on their first completed stake. No money is
 * credited here; the only agent commission is per card purchase. */
export async function markReferralActive(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, hasPlayed: true, referredByAgentId: true },
  });
  if (!user || user.hasPlayed) return false;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, hasPlayed: false },
      data: { hasPlayed: true },
    });
    if (updated.count === 0) return false;
    if (user.referredByAgentId) {
      await tx.agent.update({
        where: { id: user.referredByAgentId },
        data: { activeReferralCount: { increment: 1 } },
      });
    }
    return true;
  });
}

export async function agentStats(agentId) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { user: true } });
  if (!agent) return null;
  const [referrals, commissions, pending] = await Promise.all([
    prisma.referral.count({ where: { agentId } }),
    prisma.agentTransaction.aggregate({
      where: { agentId, status: 'completed', amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.agentWithdrawal.aggregate({
      where: { agentId, status: 'PENDING' },
      _sum: { amount: true },
    }),
  ]);
  return {
    ...agent,
    referralCount: referrals,
    totalCommission: commissions._sum.amount || 0,
    pendingWithdrawals: pending._sum.amount || 0,
  };
}
