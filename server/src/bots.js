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

// Real Ethiopian names, split into first and family names so the bots have a
// large enough pool to avoid synthetic labels like "Player1234".
const BOT_FIRST_NAMES = [
  'Abebe', 'Hana', 'Dawit', 'Selam', 'Yonas', 'Mimi', 'Kebede', 'Tigist', 'Bereket',
  'Sara', 'Mulu', 'Fikru', 'Liya', 'Samuel', 'Rahel', 'Tesfaye', 'Eden', 'Nati',
  'Bethel', 'Kalkidan', 'Henok', 'Mahi', 'Getachew', 'Tizita', 'Eyob', 'Ruth',
  'Nahom', 'Meseret', 'Solomon', 'Beza', 'Almaz', 'Aster', 'Birtukan', 'Chala',
  'Daniel', 'Desta', 'Endale', 'Frehiwot', 'Genet', 'Girma', 'Hailu', 'Hanna',
  'Kidist', 'Lidiya', 'Mekdes', 'Meron', 'Nebiyu', 'Rediet', 'Saron', 'Tekle',
  'Wubit', 'Yared', 'Yohannes', 'Zewditu', 'Amanuel', 'Bethlehem', 'Fikirte',
  'Jerusalem', 'Natnael', 'Tsion',
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
