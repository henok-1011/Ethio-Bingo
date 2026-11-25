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

// Real male Ethiopian first names, paired with family names so the bots have a
// large enough pool to avoid synthetic labels like "Player1234".
const BOT_FIRST_NAMES = [
  'Abebe', 'Abel', 'Abrham', 'Addisu', 'Alemayehu', 'Amanuel', 'Amare', 'Ayele',
  'Bekele', 'Bereket', 'Binyam', 'Biruk', 'Chala', 'Dagmawi', 'Daniel', 'Dawit',
  'Endale', 'Eyob', 'Fasil', 'Fikru', 'Gebre', 'Getachew', 'Girma', 'Girmay',
  'Habte', 'Hagos', 'Haile', 'Hailu', 'Henok', 'Kidane', 'Lemma', 'Mamo',
  'Mekonnen', 'Meles', 'Mengistu', 'Mulugeta', 'Nahom', 'Natnael', 'Nebiyu',
  'Negash', 'Negusse', 'Petros', 'Robel', 'Samuel', 'Solomon', 'Tadesse', 'Tekle',
  'Tesfaye', 'Tewodros', 'Tomas', 'Worku', 'Yared', 'Yohannes', 'Yonas', 'Zewdu',
];

const BOT_LAST_NAMES = [
  'Bekele', 'Tesfaye', 'Kebede', 'Girma', 'Haile', 'Alemu', 'Tadesse', 'Wolde',
  'Demissie', 'Mekonnen', 'Assefa', 'Desta', 'Gebre', 'Mariam', 'Negash', 'Abebe',
  'Ayele', 'Fikru', 'Lemma', 'Teshome', 'Worku', 'Yohannes', 'Zerihun', 'Berhanu',
  'Getachew', 'Hailu', 'Mengistu', 'Mulugeta', 'Wondimu', 'Zewde',
];

const BOT_NAMES = BOT_FIRST_NAMES.flatMap((first) =>
  BOT_LAST_NAMES.map((last) => `${first} ${last}`),
);

/**
 * Picks an unused Ethiopian full name. If a table ever exceeds the name pool,
 * it reuses a real name instead of falling back to a numbered player label.
 */
export function randomBotName(used = new Set(), random = Math.random) {
  const available = BOT_NAMES.filter((name) => !used.has(name));
  const pool = available.length ? available : BOT_NAMES;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  const name = pool[index];
  used.add(name);
  return name;
}
