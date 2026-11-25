export const AUTO_BOT_LIMIT = 50;

/** Auto is the default so existing installations keep their current behaviour. */
export function isBotAuto(settings = {}) {
  return String(settings.botAuto ?? '1') !== '0';
}

/**
 * Auto mode spreads the admin baseline over a wider range so consecutive
 * rounds do not cluster around the same table size. It never exceeds 50.
 * Manual mode is exact: the entered number is used as-is with no 50-bot cap.
 */
export function botSeatTarget(settings = {}, random = Math.random) {
  const parsed = Math.floor(Number(settings?.botCount));
  const requested = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!isBotAuto(settings)) return requested;

  const baseline = Math.min(AUTO_BOT_LIMIT, requested);
  if (baseline <= 0) return 0;
  const min = Math.max(4, baseline - 7);
  const max = Math.max(min, Math.min(AUTO_BOT_LIMIT, baseline + 14));
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Spreads bot card purchases across the waiting window instead of seating the
 * whole table the instant the picker opens. The last purchase still lands a
 * little before the window closes so every planned bot can be locked in.
 */
export function botJoinDelays(count, windowMs, random = Math.random) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const window = Math.max(0, Number(windowMs) || 0);
  if (!total || !window) return [];

  const first = Math.min(3200, window * 0.12);
  const last = Math.max(first, window - Math.min(3500, window * 0.2));
  const span = Math.max(0, last - first);
  const step = span / total;
  return Array.from({ length: total }, (_, index) => {
    const jitter = (Math.max(0, Math.min(1, random())) - 0.5) * step * 0.7;
    return Math.max(0, first + step * (index + 0.5) + jitter);
  });
}

// Real male Ethiopian first names. Bots use a first name only, with a chat
// emoji on some of them, so they look like ordinary player display names.
const BOT_FIRST_NAMES = [
  'Abebe', 'Abel', 'Abrham', 'Addisu', 'Alemayehu', 'Amanuel', 'Amare', 'Ayele',
  'Bekele', 'Bereket', 'Binyam', 'Biruk', 'Chala', 'Dagmawi', 'Daniel', 'Dawit',
  'Endale', 'Eyob', 'Fasil', 'Fikru', 'Gebre', 'Getachew', 'Girma', 'Girmay',
  'Habte', 'Hagos', 'Haile', 'Hailu', 'Henok', 'Kidane', 'Lemma', 'Mamo',
  'Mekonnen', 'Meles', 'Mengistu', 'Mulugeta', 'Nahom', 'Natnael', 'Nebiyu',
  'Negash', 'Negusse', 'Petros', 'Robel', 'Samuel', 'Solomon', 'Tadesse', 'Tekle',
  'Tesfaye', 'Tewodros', 'Tomas', 'Worku', 'Yared', 'Yohannes', 'Yonas', 'Zewdu',
];

const BOT_EMOJIS = ['🔥', '⚡', '🎯', '⭐', '💎', '👑', '🎲', '🚀', '🏆', '🦁', '🌟', '💫', '🍀', '🎉', '😎'];

/**
 * Picks an unused male Ethiopian first name. About a third of bots get an emoji
 * suffix, mimicking the display names many real players use in chat apps. If a
 * table ever exceeds the name pool, it reuses a first name instead of falling
 * back to a numbered player label.
 */
export function randomBotName(used = new Set(), random = Math.random) {
  const available = BOT_FIRST_NAMES.filter((first) => {
    if (used.has(first)) return false;
    for (const name of used) {
      if (String(name).startsWith(`${first} `)) return false;
    }
    return true;
  });
  const pool = available.length ? available : BOT_FIRST_NAMES;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  const first = pool[index];
  let name = first;
  if (random() >= 0.62) {
    const emojiIndex = Math.min(
      BOT_EMOJIS.length - 1,
      Math.max(0, Math.floor(random() * BOT_EMOJIS.length)),
    );
    name = `${first} ${BOT_EMOJIS[emojiIndex]}`;
  }
  used.add(name);
  return name;
}
