// End-to-end check of the real engine: every round must end with a winner
// whose shown card has exactly 2 completed patterns, and forced rounds must be
// won by the forced player. Run: DATABASE_URL=file:... node scripts/engine-e2e.mjs (local SQLite only)
import { prisma } from '../src/db.js';
import { loadSettings, setSetting } from '../src/settings.js';
import { setIO } from '../src/realtime.js';
import { startEngine, stopEngine, joinRound } from '../src/engine.js';
import { completedPatterns } from '../src/bingo.js';

const plan = [
  { type: 'bot' }, { type: 'user' }, { type: 'none' }, { type: 'bot' }, { type: 'user', manual: true }, { type: 'none' },
];
await loadSettings();
for (const [k, v] of Object.entries({ botAuto: '0', botCount: '25', waitSeconds: '5', callIntervalMs: '1000', roundEndDelayMs: '2000' })) await setSetting(k, v);
const user = await prisma.user.create({ data: { telegramId: `e2e-${Date.now()}`, firstName: 'Tester', balance: 10_000_000 } });
const other = await prisma.user.create({ data: { telegramId: `e2e2-${Date.now()}`, firstName: 'Other', balance: 10_000_000, autoMark: false } });

let index = 0;
const applyPlan = async () => {
  const p = plan[index];
  await setSetting('nextWinner', p && p.type !== 'none' ? JSON.stringify(p.type === 'user' ? { type: 'user', userId: user.id } : { type: 'bot' }) : 'none');
  if (p?.manual) await prisma.user.update({ where: { id: user.id }, data: { autoMark: false } });
  else await prisma.user.update({ where: { id: user.id }, data: { autoMark: true } });
};
await applyPlan();

const joined = new Set();
let failures = 0;
const done = new Promise((resolve) => {
  setIO({
    to: () => ({ emit() {} }),
    emit: async (event, payload) => {
      if (event === 'state' && payload.status === 'WAITING' && payload.id && !joined.has(payload.id)) {
        joined.add(payload.id);
        // The test user and a manual-marking real player join every round.
        joinRound(user, [1 + (payload.id % 400)]).catch((e) => console.log('join err', e.message));
        joinRound(other, [2 + (payload.id % 400)]).catch((e) => console.log('join err', e.message));
      }
      if (event !== 'game:ended') return;
      const p = plan[index];
      const w = payload.winners[0];
      const patterns = w?.card ? completedPatterns(w.card, new Set(w.marked)) : [];
      const forcedOk = p.type === 'none' || (p.type === 'user' ? w?.name === 'Tester' : w?.name && w.name !== 'Tester' && w.name !== 'Other');
      const ok = patterns.length === 2 && forcedOk;
      if (!ok) failures += 1;
      const g = await prisma.game.findUnique({ where: { id: payload.roundId }, include: { calledNumbers: true } }).catch(() => null);
      console.log(`round ${index + 1} forced=${p.type}${p.manual ? '(manual)' : ''} reason=${payload.reason} winner=${w?.name} calls=${g?.calledNumbers?.length} patterns=[${patterns}] ${ok ? 'OK' : 'FAIL'}`);
      index += 1;
      if (index >= plan.length) resolve();
      else await applyPlan();
    },
  });
});
await startEngine();
await done;
stopEngine();
console.log(failures ? `${failures} FAILED` : 'ALL OK');
process.exit(failures ? 1 : 0);
