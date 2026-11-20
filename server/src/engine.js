import { prisma } from './db.js';
import { getSettings, setSetting } from './settings.js';
import { cardHasBingo, generateCard, shuffleDeck, winningLineFor, winningPatternCells } from './bingo.js';
import { emptyMarks, markCard, markCalledNumbers, markedSet, unmarkCard } from './marking.js';
import { broadcast, broadcastState, emitToUser } from './realtime.js';
import { AppError } from './util.js';
import { onStake } from './agents.js';
import { computePayout, settleRound, totalRealStakes } from './payouts.js';

// Cards are numbered 1..432. Every number is a distinct card and a number
// can only be bought once per round.
export const MAX_CARDS = 432;

const BOT_NAMES = [
  'Abebe', 'Hana', 'Dawit', 'Selam', 'Yonas', 'Mimi', 'Kebede', 'Tigist', 'Bereket',
  'Sara', 'Mulu', 'Fikru', 'Liya', 'Samuel', 'Rahel', 'Tesfaye', 'Eden', 'Nati',
  'Bethel', 'Kalkidan', 'Henok', 'Mahi', 'Getachew', 'Tizita', 'Eyob', 'Ruth',
  'Nahom', 'Meseret', 'Solomon', 'Beza',
];

const state = {
  current: null,
  timer: null,
  ticking: false,
  creating: false,
  joining: new Set(),
};

function pickBotName(used) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Player${Math.floor(Math.random() * 9000) + 1000}`;
  used.add(fallback);
  return fallback;
}

function randomPhone4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function phone4From(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : randomPhone4();
}

function randomPhone() {
  return `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

/**
 * How many card seats this round should show. botCount is the admin baseline;
 * the table size changes every round and real card purchases replace bots
 * one-for-one while the round is waiting.
 */
function seatTargetFor(settings) {
  const base = Math.max(0, Math.min(50, Math.floor(Number(settings.botCount) || 0)));
  if (base <= 0) return 0;
  const min = Math.max(4, base - 2);
  const max = Math.max(min, Math.min(40, base + 8));
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Drops bots so every real card bought takes one seat at the table. */
function removeBotsForRealCards(round, count) {
  if (!round.seatTarget || count <= 0) return [];
  const bots = round.players.filter((p) => p.isBot && !p.forced);
  const currentBots = round.players.filter((p) => p.isBot).length;
  const room = Math.max(0, currentBots - round.botFloor);
  const removeCount = Math.min(count, room, bots.length);
  const removed = [];
  for (let i = 0; i < removeCount; i += 1) {
    const bot = bots.splice(Math.floor(Math.random() * bots.length), 1)[0];
    const index = round.players.indexOf(bot);
    if (index >= 0) round.players.splice(index, 1);
    for (const slot of bot.slots || []) {
      if (round.taken.get(slot) === bot.id) round.taken.delete(slot);
    }
    removed.push(bot.id);
  }
  if (removed.length) round.removedBotIds.push(...removed);
  return removed;
}

async function pruneBotsForRealCards(round) {
  const realCards = round.players
    .filter((p) => !p.isBot)
    .reduce((sum, p) => sum + (p.cards?.length || 0), 0);
  const removedBots = removeBotsForRealCards(round, realCards);
  if (!removedBots.length) return;
  await prisma.gamePlayer
    .deleteMany({ where: { id: { in: removedBots } } })
    .catch((err) => console.error('[engine] bot cleanup failed:', err.message));
  await prisma.game
    .update({ where: { id: round.id }, data: { botCount: round.players.filter((p) => p.isBot).length } })
    .catch(() => {});
}

/** Public winner phone format: +251*****9780 (only the last four digits are visible). */
export function maskPhone(value) {
  return `+251*****${phone4From(value)}`;
}

function ensureMarks(player) {
  if (!Array.isArray(player.marks)) player.marks = emptyMarks(player.cards || []);
  while (player.marks.length < (player.cards?.length || 0)) player.marks.push(new Set());
  return player.marks;
}

function winnerCardFor(player) {
  const cards = player.cards || [];
  const slots = player.slots || [];
  const marks = ensureMarks(player);
  for (let index = 0; index < cards.length; index += 1) {
    // Show every completed pattern. A forced winner with only one pattern
    // falls back to that line so the result card still has a highlight.
    const line =
      winningPatternCells(cards[index], marks[index]) || winningLineFor(cards[index], marks[index]);
    if (line) {
      return {
        card: cards[index],
        line,
        marked: [...marks[index]].sort((a, b) => a - b),
        cardNumber: slots[index] || index + 1,
      };
    }
  }
  return cards.length
    ? {
        card: cards[0],
        line: null,
        marked: [...(marks[0] || [])].sort((a, b) => a - b),
        cardNumber: slots[0] || 1,
      }
    : null;
}

function cardForSlot(round, slot) {
  return generateCard((round.seed + slot * 7919) >>> 0);
}

function prizePoolFor(round) {
  return computePayout({
    stakes: totalRealStakes(round.players),
    platformFeeRate: getSettings().platformFeeRate,
    realWinnerCount: 0,
  }).pool;
}

function playerHasBingo(player) {
  return cardHasBingo(player.cards, markedSet(ensureMarks(player)));
}

export function getPublicState() {
  const round = state.current;
  if (!round) {
    return { status: 'IDLE', playersCount: 0, realCount: 0, players: [], calledNumbers: [], prizePool: 0, stake: 0 };
  }
  const now = Date.now();
  const cards = [];
  for (const player of round.players) {
    const slots = player.slots || [];
    (player.cards || []).forEach((_card, index) => {
      cards.push({
        playerId: player.id,
        name: player.name,
        cardNumber: slots[index] || index + 1,
      });
    });
  }
  cards.sort((a, b) => a.cardNumber - b.cardNumber);
  return {
    id: round.id,
    status: round.status,
    stake: round.stake,
    prizePool: round.prizePool,
    playersCount: cards.length,
    players: cards,
    calledNumbers: [...round.called],
    lastCalled: round.lastCalled,
    takenCards: [...round.taken.keys()],
    nextCallInMs: round.status === 'CALLING' ? Math.max(0, round.nextCallAt - now) : null,
    startsInMs: round.status === 'WAITING' && Number(getSettings().autoStart) !== 0
      ? Math.max(0, round.waitEndsAt - now)
      : null,
    selectionEndsInMs: round.status === 'WAITING' ? Math.max(0, round.waitEndsAt - now) : null,
    nextRoundInMs: round.status === 'ENDED' ? Math.max(0, round.nextRoundAt - now) : null,
    roundEndDelayMs: Number(getSettings().roundEndDelayMs),
    winners: round.winners || [],
    drawNumber: round.called.size,
  };
}

export function getPlayerView(round, userId) {
  if (!round) return null;
  const player = round.players.find((p) => p.userId === userId);
  if (!player) return null;
  const payout = (round.payouts || {})[player.id] || 0;
  const marks = ensureMarks(player);
  return {
    playerId: player.id,
    cards: player.cards,
    slots: player.slots || [],
    autoMark: player.autoMark !== false,
    marked: marks.map((set) => [...set].sort((a, b) => a - b)),
    spent: player.paidStake || 0,
    hasBingo: playerHasBingo(player),
    isWinner: Boolean(round.winnerIds?.includes(player.id)),
    winAmount: payout,
    roundId: round.id,
  };
}

export function getStateForUser(userId) {
  return { ...getPublicState(), you: getPlayerView(state.current, userId) };
}

function broadcastAll() {
  const pub = getPublicState();
  broadcastState(pub);
  const round = state.current;
  if (!round) return;
  for (const player of round.players) {
    if (player.userId) {
      emitToUser(player.userId, 'you', getPlayerView(round, player.userId));
    }
  }
}

async function refundStaleRounds() {
  const stale = await prisma.game.findMany({
    where: { status: { in: ['WAITING', 'CALLING'] } },
    include: { players: true },
  });
  for (const game of stale) {
    for (const p of game.players) {
      if (!p.isBot && p.userId && p.paidStake > 0) {
        await prisma.$transaction([
          prisma.user.update({ where: { id: p.userId }, data: { balance: { increment: p.paidStake } } }),
          prisma.transaction.create({
            data: {
              userId: p.userId,
              type: 'refund',
              amount: p.paidStake,
              status: 'completed',
              reference: `game:${game.id}`,
              meta: 'Round interrupted by server restart',
            },
          }),
        ]);
        emitToUser(p.userId, 'balance', { refreshed: true });
      }
    }
    await prisma.game.update({
      where: { id: game.id },
      data: { status: 'ENDED', endedAt: new Date(), platformFee: 0, prizePool: 0 },
    });
  }
}

async function resolveNextWinner() {
  const raw = getSettings().nextWinner;
  if (!raw || raw === 'none') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.type === 'user' && parsed.userId) {
    const user = await prisma.user.findUnique({ where: { id: Number(parsed.userId) } });
    if (user && !user.isBanned) {
      return { type: 'user', userId: user.id, name: user.firstName || user.username || `User ${user.id}` };
    }
  }
  if (parsed.type === 'bot') {
    return { type: 'bot', name: parsed.name || 'Lucky Bot' };
  }
  return null;
}

async function createRound() {
  if (state.creating || state.current) return;
  state.creating = true;
  try {
    const settings = getSettings();
    const stake = Math.max(100, Number(settings.stake));
    const forced = await resolveNextWinner();
    const botCount = Math.max(seatTargetFor(settings), forced?.type === 'bot' ? 1 : 0);

    const game = await prisma.game.create({
      data: {
        stake,
        botCount,
        status: 'WAITING',
        forcedWinnerType: forced?.type || null,
        forcedWinnerId: forced?.type === 'user' ? forced.userId : null,
      },
    });

    const round = {
      id: game.id,
      status: 'WAITING',
      stake,
      seatTarget: botCount,
      botFloor: botCount > 2 ? Math.max(1, Math.round(botCount * 0.15)) : 0,
      removedBotIds: [],
      seed: game.id * 2654435761,
      bots: [],
      players: [],
      called: new Set(),
      lastCalled: null,
      deck: shuffleDeck(),
      taken: new Map(),
      waitEndsAt: Date.now() + Math.max(5, Number(settings.waitSeconds)) * 1000,
      nextCallAt: 0,
      nextRoundAt: 0,
      prizePool: 0,
      winners: [],
      winnerIds: [],
      payouts: {},
      forcedWinner: forced,
    };

    const used = new Set();
    const freeSlots = Array.from({ length: MAX_CARDS }, (_, i) => i + 1);
    for (let i = 0; i < botCount; i += 1) {
      const isForcedBot = forced?.type === 'bot' && i === 0;
      const name = isForcedBot ? forced.name : pickBotName(used);
      // Bots occupy random card numbers too, so a number stays unique per round.
      const slot = freeSlots.splice(Math.floor(Math.random() * freeSlots.length), 1)[0] || i + 1;
      const cards = [cardForSlot(round, slot)];
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: game.id,
          isBot: true,
          botName: name,
          cards: JSON.stringify(cards),
          paidStake: 0,
        },
      });
      round.taken.set(slot, row.id);
      round.players.push({
        id: row.id,
        userId: null,
        isBot: true,
        name,
        phone: randomPhone(),
        phone4: randomPhone4(),
        cards,
        slots: [slot],
        marks: emptyMarks(cards),
        autoMark: true,
        paidStake: 0,
        claimAt: 0,
        claimed: false,
        forced: isForcedBot,
      });
    }

    state.current = round;
    await prisma.game.update({ where: { id: game.id }, data: { status: 'WAITING' } });
    if (forced) await setSetting('nextWinner', 'none');
    await prisma.adminAction.create({
      data: {
        actionType: 'round_create',
        details: `game:${game.id} stake:${stake} bots:${botCount}${forced ? ` forced:${forced.type}:${forced.userId || forced.name}` : ''}`,
      },
    });
    broadcastAll();
    return round;
  } finally {
    state.creating = false;
  }
}

/**
 * Applies a winner override to the round that is currently accepting it.
 * A waiting round accepts any player (they can still buy a card); a calling
 * round only accepts a player who already holds a card. A bot override uses
 * an existing bot seat so it never adds a fake player mid-round.
 */
export async function applyWinnerToCurrentRound(override) {
  const round = state.current;
  if (!round || round.status === 'ENDED') return null;

  for (const player of round.players) player.forced = false;
  round.forcedWinner = null;

  if (override.type === 'user') {
    if (round.status === 'CALLING' && !round.players.some((p) => p.userId === override.userId)) {
      return null;
    }
    round.forcedWinner = { ...override };
  } else if (override.type === 'bot') {
    const bot = round.players.find((p) => p.isBot && !p.forced) || round.players.find((p) => p.isBot);
    if (!bot) return null;
    bot.forced = true;
    bot.name = override.name || bot.name;
    round.forcedWinner = { type: 'bot', name: bot.name };
  } else {
    return null;
  }

  await setSetting('nextWinner', 'none');
  await prisma.game
    .update({
      where: { id: round.id },
      data: {
        forcedWinnerType: round.forcedWinner.type,
        forcedWinnerId: round.forcedWinner.type === 'user' ? round.forcedWinner.userId : null,
      },
    })
    .catch(() => {});
  broadcastAll();
  return round.status === 'WAITING' ? 'waiting' : 'calling';
}

/** Clears a queued override and any override already attached to the live round. */
export async function clearWinnerOverride() {
  await setSetting('nextWinner', 'none');
  const round = state.current;
  if (!round || round.status === 'ENDED') return;
  round.forcedWinner = null;
  for (const player of round.players) player.forced = false;
  await prisma.game
    .update({ where: { id: round.id }, data: { forcedWinnerType: null, forcedWinnerId: null } })
    .catch(() => {});
  broadcastAll();
}

async function startCalling() {
  const round = state.current;
  if (!round || round.status !== 'WAITING') return;
  // Lock the table first so no more card changes can race the kickoff.
  round.status = 'CALLING';
  round.nextCallAt = Date.now();
  await pruneBotsForRealCards(round).catch((err) =>
    console.error('[engine] bot cleanup failed:', err.message),
  );
  await Promise.all(
    round.players
      .filter((p) => !p.isBot && p.userId && p.paidStake > 0)
      .map((p) =>
        onStake(p.userId, p.paidStake).catch((err) =>
          console.error('[engine] stake commission failed:', err.message),
        ),
      ),
  );
  await prisma.game.update({ where: { id: round.id }, data: { status: 'CALLING', startedAt: new Date() } });
  broadcast('game:started', { roundId: round.id });
  broadcastAll();
}

async function callNextNumber() {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  const number = round.deck.pop();
  if (!number) {
    await finishRound(null, 'exhausted');
    return;
  }
  round.called.add(number);
  round.lastCalled = number;
  for (const player of round.players) {
    if (player.autoMark) markCalledNumbers(player.cards, ensureMarks(player), [number]);
  }
  round.nextCallAt = Date.now() + Math.max(1000, Number(getSettings().callIntervalMs));
  await prisma.calledNumber.create({ data: { gameId: round.id, number } }).catch(() => {});
  broadcast('number', { number, roundId: round.id });
}

function scheduleBotClaims() {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  if (round.forcedWinner?.type === 'user') {
    const inRound = round.players.some((p) => p.userId === round.forcedWinner.userId);
    if (inRound) return; // hold bots for the forced human winner
    // The forced player never joined: let the round play out normally.
    round.forcedWinner = null;
  }
  const now = Date.now();
  for (const player of round.players) {
    if (!player.isBot || player.claimed) continue;
    if (!playerHasBingo(player, round)) continue;
    const quick = round.forcedWinner?.type === 'bot' && player.forced;
    if (!player.claimAt) {
      player.claimAt = now + (quick ? 700 : 1500 + Math.random() * 2500);
    } else if (now >= player.claimAt) {
      player.claimed = true;
      finishRound(player, 'bot');
      return;
    }
  }
}

async function finishRound(triggerPlayer, reason) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') return;
  round.status = 'ENDED';
  const settings = getSettings();

  let winners = [];
  if (round.forcedWinner) {
    const forced = round.players.find((p) =>
      round.forcedWinner.type === 'user' ? p.userId === round.forcedWinner.userId : p.isBot && p.forced,
    );
    if (forced) winners = [forced];
  }
  if (!winners.length) {
    winners = round.players.filter((p) => playerHasBingo(p, round));
    if (!winners.length && triggerPlayer) winners = [triggerPlayer];
  }

  const realWinners = winners.filter((p) => !p.isBot);
  const { pool, platformFee, share } = settleRound({
    stakes: totalRealStakes(round.players),
    platformFeeRate: settings.platformFeeRate,
    realWinnerCount: realWinners.length,
  });

  // Bots hold seats, never money. A bot winner gets no prize and the stakes
  // stay with the platform; only real winners are paid from the real pool.

  // Real winners show their cash prize. A bot win still shows the winning
  // card and masked phone, but no amount: no money moves for a bot.
  round.winners = winners.map((p) => {
    const winning = winnerCardFor(p);
    return {
      name: p.name,
      phone4: phone4From(p.phone),
      phoneMasked: maskPhone(p.phone),
      amount: p.isBot ? 0 : share,
      cardNumber: winning?.cardNumber || 1,
      card: winning?.card || null,
      line: winning?.line || null,
      marked: winning?.marked || [],
    };
  });
  round.winnerIds = winners.map((p) => p.id);
  round.payouts = {};
  for (const p of winners) if (!p.isBot) round.payouts[p.id] = share;
  round.prizePool = pool;
  round.nextRoundAt = Date.now() + Math.max(2000, Number(settings.roundEndDelayMs));

  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: round.id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        prizePool: pool,
        platformFee,
        winnerId: realWinners[0]?.userId || null,
      },
    });

    for (const player of round.players) {
      const isWinner = realWinners.includes(player);
      await tx.gamePlayer.update({
        where: { id: player.id },
        data: {
          hasBingo: playerHasBingo(player, round),
          isWinner,
          winAmount: isWinner ? share : 0,
        },
      });
      if (isWinner && player.userId && share > 0) {
        await tx.user.update({ where: { id: player.userId }, data: { balance: { increment: share } } });
        await tx.transaction.create({
          data: {
            userId: player.userId,
            type: 'win',
            amount: share,
            status: 'completed',
            reference: `game:${round.id}`,
          },
        });
      }
    }

    if (round.forcedWinner) {
      await tx.adminAction.create({
        data: {
          actionType: 'winner_override_used',
          details: `game:${round.id} forced:${round.forcedWinner.type}:${round.forcedWinner.userId || round.forcedWinner.name}`,
        },
      });
    }
  });

  for (const p of realWinners) {
    if (!p.userId) continue;
    const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { balance: true } });
    emitToUser(p.userId, 'balance', { balance: user?.balance ?? 0 });
  }

  broadcast('game:ended', {
    roundId: round.id,
    winners: round.winners,
    winnerIds: round.winnerIds,
    prizePool: pool,
    reason,
  });
  broadcastAll();
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const round = state.current;
    if (!round) {
      await createRound();
      return;
    }
    const now = Date.now();
    if (round.status === 'WAITING') {
      const auto = Number(getSettings().autoStart) !== 0;
      if (auto && now >= round.waitEndsAt) {
        await startCalling();
        await callNextNumber();
      }
    } else if (round.status === 'CALLING') {
      if (now >= round.nextCallAt) {
        await callNextNumber();
      }
      scheduleBotClaims();
    } else if (round.status === 'ENDED' && now >= round.nextRoundAt) {
      state.current = null;
      await createRound();
      return;
    }
    broadcastAll();
  } catch (err) {
    console.error('[engine] tick failed', err);
  } finally {
    state.ticking = false;
  }
}

export async function startEngine() {
  await refundStaleRounds();
  await createRound();
  state.timer = setInterval(tick, 1000);
  console.log('[engine] started');
}

export function stopEngine() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/**
 * Player picks one or more card numbers (1..432) while the round is open.
 * Each pick costs the round stake (20 ETB by default) and is charged
 * immediately. A card number is reserved for the whole round, so no one else
 * can pick it. The waiting window is the selection window (30s by default).
 */
export async function joinRound(user, selection = []) {
  const round = state.current;
  if (!round) throw new AppError('ቀጣዩ ዙር እየተዘጋጀ ነው። ከጥቂት ጊዜ በኋላ እንደገና ይሞክሩ።');
  if (round.status !== 'WAITING') throw new AppError('ይህ ዙር አስቀድሞ ተጀምሯል። ቀጣዩን ዙር ይጠብቁ።');
  if (user.isBanned) throw new AppError('ይህ መለያ ታግዷል።', 403);
  if (Date.now() >= round.waitEndsAt) {
    throw new AppError('የመምረጫ ጊዜው አልቋል። ቀጣዩን ዙር ይጠብቁ።');
  }
  if (state.joining.has(user.id)) {
    throw new AppError('ቀድሞ በመካሄድ ላይ ነው። እባክዎ ትንሽ ይጠብቁ።');
  }

  const raw = Array.isArray(selection) ? selection : selection == null ? [] : [selection];
  const slots = [...new Set(raw.map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v)))];
  if (!slots.length) throw new AppError(`ከ1 እስከ ${MAX_CARDS} የካርድ ቁጥር ይምረጡ።`);
  if (slots.length !== raw.length) throw new AppError('እያንዳንዱን ካርድ አንድ ጊዜ ብቻ ይምረጡ።');
  if (slots.some((s) => s < 1 || s > MAX_CARDS)) {
    throw new AppError(`ካርድ ቁጥር ከ1 እስከ ${MAX_CARDS} መሆን አለበት።`);
  }
  const clash = slots.find((s) => round.taken.has(s));
  if (clash) throw new AppError(`ካርድ #${clash} አስቀድሞ ተመርጧል። ሌላ ቁጥር ይምረጡ።`);

  // Reserve the numbers synchronously so two players can never get the same one.
  state.joining.add(user.id);
  for (const slot of slots) round.taken.set(slot, user.id);

  const total = round.stake * slots.length;
  let charged = false;
  try {
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh || fresh.balance < total) {
      throw new AppError('ቀሪ ሂሳብ በቂ አይደለም። እባክዎ መጀመሪያ ያስገቡ።');
    }

    const reserved = await prisma.user.updateMany({
      where: { id: user.id, balance: { gte: total } },
      data: { balance: { decrement: total } },
    });
    if (reserved.count === 0) throw new AppError('ቀሪ ሂሳብ በቂ አይደለም። እባክዎ መጀመሪያ ያስገቡ።');
    charged = true;

    // The window may have closed while the balance was being checked.
    if (round.status !== 'WAITING' || Date.now() >= round.waitEndsAt) {
      throw new AppError('የመምረጫ ጊዜው አልቋል። ቀጣዩን ዙር ይጠብቁ።');
    }

    const generated = slots.map((slot) => cardForSlot(round, slot));
    let player = round.players.find((p) => p.userId === user.id);

    if (player) {
      player.cards = [...player.cards, ...generated];
      player.slots = [...(player.slots || []), ...slots];
      player.marks = [...ensureMarks(player), ...emptyMarks(generated)];
      player.autoMark = fresh.autoMark !== false;
      if (player.autoMark) markCalledNumbers(player.cards, player.marks, round.called);
      player.paidStake += total;
      await prisma.gamePlayer.update({
        where: { id: player.id },
        data: { cards: JSON.stringify(player.cards), paidStake: player.paidStake },
      });
    } else {
      const row = await prisma.gamePlayer.create({
        data: {
          gameId: round.id,
          userId: user.id,
          cards: JSON.stringify(generated),
          paidStake: total,
        },
      });
      player = {
        id: row.id,
        userId: user.id,
        isBot: false,
        name: fresh.firstName || fresh.username || `Player ${user.id}`,
        phone: fresh.phone || null,
        phone4: phone4From(fresh.phone),
        cards: generated,
        slots: [...slots],
        marks: emptyMarks(generated),
        autoMark: fresh.autoMark !== false,
        paidStake: total,
        claimAt: 0,
        claimed: false,
        forced: false,
      };
      round.players.push(player);
    }

    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'stake',
        amount: total,
        status: 'completed',
        reference: `game:${round.id}`,
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { derash: { increment: Math.floor(total / 1000) } },
    });

    round.prizePool = prizePoolFor(round);
    await prisma.game.update({ where: { id: round.id }, data: { prizePool: round.prizePool } });

    const updated = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
    emitToUser(user.id, 'balance', { balance: updated.balance });
    emitToUser(user.id, 'you', getPlayerView(round, user.id));
    broadcastAll();

    return {
      playerId: player.id,
      cards: player.cards,
      slots: player.slots,
      spent: player.paidStake,
      balance: updated.balance,
      you: getPlayerView(round, user.id),
    };
  } catch (err) {
    for (const slot of slots) {
      if (round.taken.get(slot) === user.id) round.taken.delete(slot);
    }
    if (charged) {
      await prisma.user
        .update({ where: { id: user.id }, data: { balance: { increment: total } } })
        .catch(() => {});
    }
    throw err;
  } finally {
    state.joining.delete(user.id);
  }
}

/**
 * Removes one card from a player's waiting-round selection. The number is freed
 * and the stake is refunded so the player can choose a different card before
 * the round starts. Once calling begins, selections are locked.
 */
export async function deselectCard(user, cardNumber) {
  const round = state.current;
  if (!round || round.status !== 'WAITING' || Date.now() >= round.waitEndsAt) {
    throw new AppError('የመምረጫ ጊዜው አልቋል። የመረጡት ካርዶች ተቆልፈዋል።');
  }
  if (state.joining.has(user.id)) {
    throw new AppError('ቀድሞ በመካሄድ ላይ ነው። እባክዎ ትንሽ ይጠብቁ።');
  }

  const slot = Math.floor(Number(cardNumber));
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_CARDS) {
    throw new AppError(`ካርድ ቁጥር ከ1 እስከ ${MAX_CARDS} መሆን አለበት።`);
  }

  const player = round.players.find((p) => p.userId === user.id);
  if (!player) throw new AppError('በዚህ ዙር አይጫወቱም።');
  const cardIndex = (player.slots || []).indexOf(slot);
  if (cardIndex < 0) throw new AppError('ይህ ካርድ በምርጫዎ ውስጥ አልገኘም።');

  state.joining.add(user.id);
  try {
    const nextCards = (player.cards || []).filter((_card, index) => index !== cardIndex);
    const nextSlots = (player.slots || []).filter((_slot, index) => index !== cardIndex);
    const nextMarks = ensureMarks(player).filter((_mark, index) => index !== cardIndex);
    const refund = Math.min(round.stake, Math.max(0, player.paidStake || 0));
    const nextPaid = Math.max(0, (player.paidStake || 0) - refund);
    const playerIndex = round.players.indexOf(player);
    const remainingStakes = Math.max(0, totalRealStakes(round.players) - refund);
    const nextPool = computePayout({
      stakes: remainingStakes,
      platformFeeRate: getSettings().platformFeeRate,
      realWinnerCount: 0,
    }).pool;

    await prisma.$transaction(async (tx) => {
      if (nextCards.length) {
        await tx.gamePlayer.update({
          where: { id: player.id },
          data: { cards: JSON.stringify(nextCards), paidStake: nextPaid },
        });
      } else {
        await tx.gamePlayer.delete({ where: { id: player.id } });
      }
      if (refund > 0) {
        await tx.user.update({
          where: { id: user.id },
          data: { balance: { increment: refund } },
        });
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: 'refund',
            amount: refund,
            status: 'completed',
            reference: `game:${round.id}`,
            meta: `Card #${slot} deselected`,
          },
        });
      }
      await tx.game.update({ where: { id: round.id }, data: { prizePool: nextPool } });
    });

    round.taken.delete(slot);
    player.cards = nextCards;
    player.slots = nextSlots;
    player.marks = nextMarks;
    player.paidStake = nextPaid;
    if (!nextCards.length && playerIndex >= 0) round.players.splice(playerIndex, 1);
    round.prizePool = nextPool;

    const updated = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
    const view = getPlayerView(round, user.id);
    emitToUser(user.id, 'balance', { balance: updated?.balance ?? 0 });
    emitToUser(user.id, 'you', view);
    broadcastAll();

    return { ok: true, card: slot, you: view, balance: updated?.balance ?? 0 };
  } finally {
    state.joining.delete(user.id);
  }
}

export async function claimBingo(user) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') {
    throw new AppError('ማመልከቻ የሚቻልበት ንቁ ዙር የለም።');
  }
  const player = round.players.find((p) => p.userId === user.id);
  if (!player) throw new AppError('በዚህ ዙር አይጫወቱም።');

  if (!playerHasBingo(player, round)) {
    throw new AppError('የተሳሳተ ጥያቄ — እስካሁን ቢንጎ የለዎትም። ጨዋታውን ይቀጥሉ።');
  }

  await finishRound(player, 'claim');
  return { ok: true, winners: round.winners };
}

/**
 * Per-player Auto Marking. Turning it ON immediately marks every called number
 * that is on the player's cards; turning it OFF leaves existing marks intact
 * and requires a tap for future calls.
 */
export async function setAutoMark(user, enabled) {
  const autoMark = Boolean(enabled);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { autoMark },
    select: { autoMark: true },
  });

  const round = state.current;
  const player = round?.players.find((p) => p.userId === user.id);
  if (!player) return { autoMark: updated.autoMark, you: null };

  player.autoMark = updated.autoMark;
  if (player.autoMark) markCalledNumbers(player.cards, ensureMarks(player), round.called);
  emitToUser(user.id, 'you', getPlayerView(round, user.id));
  return { autoMark: updated.autoMark, you: getPlayerView(round, user.id) };
}

/** Records one manual mark for an Auto OFF player. */
export async function markNumber(user, cardIndex, number) {
  const round = state.current;
  if (!round || round.status !== 'CALLING') {
    throw new AppError('ማመልከቻ የሚቻልበት ንቁ ዙር የለም።');
  }
  const player = round.players.find((p) => p.userId === user.id);
  if (!player) throw new AppError('በዚህ ዙር አይጫወቱም።');
  if (player.autoMark !== false) {
    throw new AppError('Auto Marking ON ነው። ቁጥሮች በራስ-ሰር ይመረጣሉ።');
  }

  const index = Math.floor(Number(cardIndex));
  const n = Math.floor(Number(number));
  if (!Number.isInteger(index) || index < 0 || index >= (player.cards || []).length) {
    throw new AppError('ካርድ አልተገኘም።');
  }
  if (!Number.isInteger(n) || !round.called.has(n)) {
    throw new AppError('ይህ ቁጥር አልተጠራም።');
  }

  const marks = ensureMarks(player);
  const wasMarked = marks[index].has(n);
  const changed = wasMarked
    ? unmarkCard(player.cards, marks, index, n)
    : markCard(player.cards, marks, index, n);
  if (!changed) {
    throw new AppError('ይህ ቁጥር በካርድዎ ላይ አልተገኘም።');
  }

  const view = getPlayerView(round, user.id);
  emitToUser(user.id, 'you', view);
  return { ok: true, marked: !wasMarked, you: view };
}

export async function startRoundNow() {
  const round = state.current;
  if (!round) throw new AppError('No round is waiting.');
  if (round.status !== 'WAITING') throw new AppError('This round is already running.');
  await startCalling();
  await callNextNumber();
  broadcastAll();
}

export async function adminRoundDetails() {
  const round = state.current;
  if (!round) return null;
  return {
    ...getPublicState(),
    realCount: round.players.filter((p) => !p.isBot).length,
    realCards: round.players.filter((p) => !p.isBot).reduce((sum, p) => sum + (p.cards?.length || 0), 0),
    bots: round.players.filter((p) => p.isBot).map((p) => ({ id: p.id, name: p.name })),
    forcedWinner: round.forcedWinner,
    calledOrder: [...round.called],
    upcomingNumbers: [...round.deck].reverse(),
    realPlayers: round.players
      .filter((p) => !p.isBot)
      .map((p) => ({
        id: p.userId,
        name: p.name,
        bingo: playerHasBingo(p, round),
        cards: p.cards,
        cardCount: p.cards.length,
        numbers: p.slots || [],
      })),
  };
}
