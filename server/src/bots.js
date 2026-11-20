export const AUTO_BOT_LIMIT = 50;

/** Auto is the default so existing installations keep their current behaviour. */
export function isBotAuto(settings = {}) {
  return String(settings.botAuto ?? '1') !== '0';
}

/**
 * Auto mode varies the admin baseline by a small amount and never exceeds 50.
 * Manual mode is exact: the entered number is used as-is with no 50-bot cap.
 */
export function botSeatTarget(settings = {}, random = Math.random) {
  const parsed = Math.floor(Number(settings?.botCount));
  const requested = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!isBotAuto(settings)) return requested;

  const baseline = Math.min(AUTO_BOT_LIMIT, requested);
  if (baseline <= 0) return 0;
  const min = Math.max(4, baseline - 2);
  const max = Math.max(min, Math.min(AUTO_BOT_LIMIT, baseline + 8));
  return min + Math.floor(random() * (max - min + 1));
}
